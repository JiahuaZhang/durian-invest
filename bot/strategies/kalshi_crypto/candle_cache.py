"""
CandleCache — shared 1-min OHLCV store for all active ContractWindows.

Refreshed at :25 and :55 each minute via the global tick in KalshiCryptoStrategy.
ContractWindows read from here; they never call the price API directly.
This means each asset gets exactly 2 price fetches per minute regardless of
how many concurrent windows are active.
"""
import asyncio
import logging
from typing import Optional, TYPE_CHECKING

from .models import PriceWindow

if TYPE_CHECKING:
    from .kalshi_crypto_client import KalshiCryptoClient

logger = logging.getLogger(__name__)


class CandleCache:
    def __init__(self, client: "KalshiCryptoClient"):
        self._client = client
        self._cache: dict[str, PriceWindow] = {}  # asset_id → PriceWindow

    def get(self, asset_id: str) -> Optional[PriceWindow]:
        """Non-blocking in-memory read. Returns None if never successfully fetched."""
        return self._cache.get(asset_id)

    async def refresh(self, asset_ids: list[str]) -> None:
        """
        Fetch price windows for all asset_ids concurrently.
        Called at :25 and :55 each minute. Failures leave the previous value
        in place so windows continue with slightly stale but valid data.
        """
        results = await asyncio.gather(
            *[self._client.get_price_window(aid) for aid in asset_ids],
            return_exceptions=True,
        )
        for asset_id, result in zip(asset_ids, results):
            if isinstance(result, Exception):
                logger.warning(f"Candle refresh failed for {asset_id}: {result}")
            elif result is not None:
                self._cache[asset_id] = result
