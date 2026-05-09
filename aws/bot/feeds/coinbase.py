"""
Coinbase BTC-USD real-time price feed via WebSocket.

Subscribes to the Coinbase Exchange ticker channel.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

import websockets

logger = logging.getLogger(__name__)

COINBASE_WS = "wss://ws-feed.exchange.coinbase.com"


class CoinbaseFeed:
    """Async Coinbase BTC-USD price stream."""

    def __init__(self, product: str = "BTC-USD"):
        self.product = product
        self.price: float = 0.0
        self.last_update: float = 0.0
        self._running = False

    @property
    def stale(self) -> bool:
        return time.monotonic() - self.last_update > 10 if self.last_update else True

    async def connect(self):
        """Start streaming prices. Runs until cancelled."""
        self._running = True
        logger.info(f"Coinbase WS connecting: {COINBASE_WS} product={self.product}")

        while self._running:
            try:
                async with websockets.connect(COINBASE_WS) as ws:
                    sub = json.dumps({
                        "type": "subscribe",
                        "product_ids": [self.product],
                        "channels": ["ticker"],
                    })
                    await ws.send(sub)
                    logger.info("Coinbase WS connected")

                    async for raw in ws:
                        msg = json.loads(raw)
                        if msg.get("type") == "ticker" and "price" in msg:
                            self.price = float(msg["price"])
                            self.last_update = time.monotonic()
            except (websockets.ConnectionClosed, ConnectionError) as e:
                logger.warning(f"Coinbase WS disconnected: {e}")
                await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"Coinbase WS error: {e}", exc_info=True)
                await asyncio.sleep(5)

    def stop(self):
        self._running = False
