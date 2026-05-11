import asyncio
import logging
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from ..config import BotConfig
from ..feeds.polymarket_crypto_price import PolymarketCryptoPrice
from ..feeds.polymarket_market_channel import PolymarketMarketChannel
from ..feeds.polymarket_state import PolymarketState
from ..market_state import get_market_slug, get_window_range
from ..markets import Market, get_market_by_slug

logger = logging.getLogger(__name__)


class FeedManager:
    """
    Manager for Polymarket up/down markets.

    A cron-aligned scheduler activates a new market on every interval
    boundary. With `interval_minutes=5`, the trigger `*/5 * * * *` fires at
    minute 0, 5, 10, 15, ... — exactly the start of each new window.

    Each tick: fetch the current market, create its state, and add the
    orderbook to the websocket subscription. Resolved markets are removed
    when the websocket emits `market_resolved`.
    """

    def __init__(self, cfg: BotConfig):
        self.cfg = cfg
        self.poly_ws = PolymarketMarketChannel(on_message=self._on_market_msg)
        self.states: dict[str, PolymarketState] = {}
        self.current_market: Market | None = None
        self.scheduler = AsyncIOScheduler()
        self._poly_task: asyncio.Task | None = None

    async def run(self) -> None:
        """Run until cancelled. Activates a new market every interval boundary."""
        logger.info(
            "Starting FeedManager | crypto=%s interval=%dm",
            self.cfg.crypto,
            self.cfg.interval_minutes,
        )
        self._poly_task = asyncio.create_task(self.poly_ws.connect(), name="polymarket-market-feed")

        await self._activate_current_window()

        self.scheduler.add_job(
            self._activate_current_window,
            CronTrigger(minute=f"*/{self.cfg.interval_minutes}"),
            id="window-activation",
            coalesce=True,
            misfire_grace_time=30,
        )
        self.scheduler.start()
        logger.info("Scheduler started | cron=*/%d * * * *", self.cfg.interval_minutes)

        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            pass
        finally:
            self.stop()

    async def _activate_current_window(self) -> None:
        """Fetch the current window's market and add its orderbook to states."""
        slug = get_market_slug(self.cfg.crypto, self.cfg.interval_minutes)

        if self.current_market is not None and self.current_market.slug == slug:
            logger.error("Already subscribed to market: %s", slug)
            raise ValueError(f"Already subscribed to market: {slug}")

        logger.info("Activating market: slug=%s", slug)

        market = await get_market_by_slug(slug)
        if market is None:
            logger.warning("Market not found yet: %s; will retry next tick", slug)
            return

        start_ts, end_ts = get_window_range(self.cfg.crypto, self.cfg.interval_minutes)
        state = PolymarketState(
            cfg=self.cfg,
            market=market,
            asset=market.up_token_id,
            start_ts=start_ts,
            end_ts=end_ts,
        )
        self.states[market.up_token_id] = state
        self.current_market = market

        self.poly_ws.subscribe([market.up_token_id])
        logger.info(
            "Subscribed: slug=%s up_token=%s... active_states=%d",
            slug,
            market.up_token_id[:16],
            len(self.states),
        )

        # Fetch open price in the background — Chainlink typically
        # publishes within a few seconds of the window boundary.
        asyncio.create_task(
            self._poll_open_price(state, slug),
            name=f"open-price-{slug}",
        )

    async def _poll_open_price(self, state: PolymarketState, slug: str) -> None:
        """Poll for the open price every 2s, up to 30s total."""
        for attempt in range(15):
            await asyncio.sleep(2)
            price = await PolymarketCryptoPrice.get_open_price(slug)
            if price is not None:
                state.open_price = price
                logger.info("Open price set for %s: $%.2f (attempt %d)", slug, price, attempt + 1)
                return

        logger.warning("Open price still unavailable after 30s for %s", slug)

    def _on_market_msg(self, msg: dict[str, Any]) -> None:
        for state in self.states.values():
            state.apply_market_message(msg)

        if msg.get("event_type") == "market_resolved":
            self._on_market_resolved(msg)

    def _on_market_resolved(self, msg: dict[str, Any]) -> None:
        assets_ids = set(msg.get("assets_ids") or msg.get("asset_ids") or [])
        resolved = [aid for aid in self.states if aid in assets_ids]
        if not resolved:
            raise ValueError(f"No resolved states found for assets: {assets_ids}")

        self.poly_ws.unsubscribe(resolved)
        for aid in resolved:
            self.states.pop(aid, None)
            logger.info("Unsubscribed from asset %s, market resolved", aid)

    def stop(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

        for state in list(self.states.values()):
            self.poly_ws.unsubscribe([state.asset])

        self.states.clear()
        self.current_market = None

        self.poly_ws.stop()
        if self._poly_task:
            self._poly_task.cancel()
            self._poly_task = None
