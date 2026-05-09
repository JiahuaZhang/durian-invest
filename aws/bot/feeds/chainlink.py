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

import httpx

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
        on_update: Callable[[str, float], None] | None = None
    ):
        self.feed_id = feed_id
        self.poll_seconds = poll_seconds
        self.on_update = on_update
        self.price: float = 0.0
        self.last_update: float = 0.0
        self._running = False

    @property
    def stale(self) -> bool:
        return time.monotonic() - self.last_update > 30 if self.last_update else True

    async def connect(self):
        """Poll Chainlink price continuously."""
        self._running = True
        logger.info(f"Chainlink feed starting: feed_id={self.feed_id[:16]}... poll={self.poll_seconds}s")

        async with httpx.AsyncClient(timeout=10) as client:
            while self._running:
                try:
                    price = await self._fetch_price(client)
                    if price and price > 0:
                        self.price = price
                        self.last_update = time.monotonic()
                        if self.on_update:
                            self.on_update("chainlink", self.price)
                except Exception as e:
                    logger.warning(f"Chainlink fetch error: {e}")
                await asyncio.sleep(self.poll_seconds)

    async def _fetch_price(self, client: httpx.AsyncClient) -> float | None:
        """Fetch latest BTC/USD bid price from Chainlink Data Streams."""
        params = {
            "feedId": self.feed_id,
            "abiIndex": 0,
            "queryWindow": "1m",
            "attributeName": "bid",
        }
        resp = await client.get(CHAINLINK_API, params=params)
        resp.raise_for_status()
        data = resp.json()

        nodes = data.get("data", {}).get("allStreamValuesGenerics", {}).get("nodes", [])
        if not nodes:
            return None

        # First node is the most recent price
        return float(nodes[0]["valueNumeric"])

    def stop(self):
        self._running = False
