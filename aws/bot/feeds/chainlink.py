"""
Chainlink BTC/USD price feed via Data Streams API.

This is what Polymarket resolves against: https://data.chain.link/streams/btc-usd
The API returns sub-second price updates, much better than the old
on-chain aggregator approach.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable

logger = logging.getLogger(__name__)

CHAINLINK_API = "https://data.chain.link/api/live-data-engine-stream-data"

# BTC/USD feed ID on Chainlink Data Streams
BTC_USD_FEED_ID = "0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8"


class ChainlinkFeed:
    """Poll Chainlink Data Streams API for BTC/USD price."""

    def __init__(
        self,
        feed_id: str = BTC_USD_FEED_ID,
        poll_seconds: int = 1,
        on_update: Callable[[str, float], None] | None = None,
        stop_event: asyncio.Event | None = None
    ):
        self.feed_id = feed_id
        self.poll_seconds = poll_seconds
        self.on_update = on_update
        self.stop_event = stop_event
        self.price: float = 0.0
        self.last_update: float = 0.0
        self._running = False

    @property
    def stale(self) -> bool:
        return time.monotonic() - self.last_update > 30 if self.last_update else True

    async def connect(self):
        """Poll Chainlink price continuously using DrissionPage to bypass Vercel 429s."""
        self._running = True
        logger.info(f"Chainlink feed starting: feed_id={self.feed_id[:16]}... poll={self.poll_seconds}s")

        # DrissionPage is synchronous, so we run initialization in a thread
        from DrissionPage import ChromiumPage, ChromiumOptions

        def _init_browser():
            co = ChromiumOptions()
            co.headless(True)
            co.auto_port()  # Avoid port conflicts with zombie processes
            co.set_argument('--disable-blink-features=AutomationControlled')
            co.set_user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
            # Mute audio to avoid any hidden media autoplay errors
            co.mute(True)
            
            p = ChromiumPage(co)
            return p
            
        def _navigate_and_bypass(p: ChromiumPage):
            logger.info("DrissionPage: Navigating to Chainlink to bypass Cloudflare...")
            p.clear_cache(cookies=True)
            p.get("https://data.chain.link/streams/btc-usd-cexprice-streams")
            
            # Wait for Vercel Security Checkpoint to pass
            p.wait.title_change('Just a moment...', timeout=15)
            logger.info(f"DrissionPage: Cloudflare bypassed. Title: {p.title}")

        try:
            page = await asyncio.to_thread(_init_browser)
            await asyncio.to_thread(_navigate_and_bypass, page)
        except Exception as e:
            logger.error(f"Failed to initialize DrissionPage: {e}")
            if self.stop_event:
                self.stop_event.set()
            return

        url = f"{CHAINLINK_API}?feedId={self.feed_id}&abiIndex=0&queryWindow=1m&attributeName=bid"

        def _fetch():
            res = page.run_js(f'''
                return fetch('{url}').then(r => {{
                    if (!r.ok) return {{error: r.status}};
                    return r.json();
                }}).catch(e => ({{error: e.toString()}}));
            ''')
            if 'error' in res:
                return None, res['error']
            try:
                nodes = res.get('data', {}).get('allStreamValuesGenerics', {}).get('nodes', [])
                if nodes:
                    return float(nodes[0]['valueNumeric']), None
            except Exception as e:
                return None, str(e)
            return None, "No nodes returned"

        while self._running:
            try:
                price, err = await asyncio.to_thread(_fetch)
                
                if price is not None:
                    self.price = price
                    self.last_update = time.time()
                    if self.on_update:
                        self.on_update("chainlink", self.price)
                else:
                    if err == 429 or (isinstance(err, str) and "SyntaxError" in err):
                        logger.warning(f"Chainlink feed got blocked (Error: {err}). Attempting to recover by clearing cookies and refreshing...")
                        # await asyncio.sleep(5)
                        await asyncio.to_thread(_navigate_and_bypass, page)
                        logger.info("Chainlink feed recovery attempt complete. Resuming polling.")
                        continue
                    elif isinstance(err, int) and 500 <= err < 600:
                        logger.warning(f"Chainlink API transient server error ({err}). Retrying...")
                        continue
                    else:
                        logger.error(f"Chainlink fetch encountered unknown error: {err}. Halting bot.")
                        if self.stop_event:
                            self.stop_event.set()
                        break
                        
            except Exception as e:
                logger.error(f"Chainlink feed error: {e}. Halting bot.")
                if self.stop_event:
                    self.stop_event.set()
                break
                
            if self._running:
                await asyncio.sleep(self.poll_seconds)
                
        # Cleanup browser gracefully
        try:
            await asyncio.to_thread(page.quit)
        except Exception:
            pass

    def stop(self):
        """Stop polling loop."""
        self._running = False
