"""
Binance BTCUSDT real-time price feed via WebSocket.

Streams trade events from Binance to track the latest BTC spot price.
Proxy-aware: uses SOCKS5 on local dev, direct on AWS.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Callable

import websockets

logger = logging.getLogger(__name__)

BINANCE_WS = "wss://stream.binance.com:9443/ws/{symbol}@trade"
# Fallback for geo-restricted regions
BINANCE_WS_ALT = "wss://stream.binance.us:9443/ws/{symbol}@trade"


class BinanceFeed:
    """Async Binance BTCUSDT price stream."""

    def __init__(
        self,
        symbol: str = "btcusdt",
        proxy: str | None = None,
        on_update: Callable[[str, float], None] | None = None
    ):
        self.symbol = symbol.lower()
        self.proxy = proxy
        self.on_update = on_update
        self.price: float = 0.0
        self.last_update: float = 0.0
        self._running = False
        self._ws: websockets.WebSocketClientProtocol | None = None

    @property
    def stale(self) -> bool:
        """True if no update for >10 seconds."""
        return time.monotonic() - self.last_update > 10 if self.last_update else True

    async def connect(self):
        """Start streaming prices. Runs until cancelled."""
        url = BINANCE_WS.format(symbol=self.symbol)
        self._running = True
        logger.info(f"Binance WS connecting: {url} (proxy={bool(self.proxy)})")

        while self._running:
            try:
                async with websockets.connect(url, proxy=self.proxy) as ws:
                    self._ws = ws
                    logger.info("Binance WS connected")
                    async for raw in ws:
                        msg = json.loads(raw)
                        self.price = float(msg["p"])
                        self.last_update = time.monotonic()
                        if self.on_update:
                            self.on_update("binance", self.price)
            except (websockets.ConnectionClosed, ConnectionError) as e:
                logger.warning(f"Binance WS disconnected: {e}")
                await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"Binance WS error: {e}", exc_info=True)
                await asyncio.sleep(5)

    def stop(self):
        self._running = False
        if getattr(self, "_ws", None):
            asyncio.create_task(self._ws.close())
