"""
Predict.fun crypto up/down market lookup.

Fetches OPEN CRYPTO_UP_DOWN markets from the predict.fun REST API
and filters by the deterministic categorySlug pattern to find the
current 5-min window market.

API reference: https://dev.predict.fun/get-markets-25326905e0
"""

from __future__ import annotations

import logging
import time

import httpx

from ..config import PredictConfig

logger = logging.getLogger(__name__)


class PredictMarketClient:
    """Client for predict.fun market lookups."""

    def __init__(self, predict: PredictConfig) -> None:
        self._predict = predict

    @staticmethod
    def get_category_slug(crypto: str = "btc", interval_minutes: int = 5, offset: int = 0) -> str:
        """Build the predict.fun categorySlug for a crypto up/down window.

        Pattern: ``{crypto}-updown-{interval}m-{timestamp}``

        The timestamp is Unix seconds (UTC), floored to the interval boundary.

        Args:
            crypto: ticker — btc, eth, sol, etc.
            interval_minutes: window size (default 5).
            offset: 0 = current window, -1 = previous, +1 = next.

        Returns:
            e.g. ``"btc-updown-5m-1778804700"``
        """
        now = int(time.time())
        interval_seconds = interval_minutes * 60
        window_start = (now // interval_seconds) * interval_seconds
        ts = window_start + offset * interval_seconds
        return f"{crypto}-updown-{interval_minutes}m-{ts}"

    async def get_current_5m_crypto_market(
        self,
        crypto: str = "btc",
        offset: int = 0,
    ) -> dict | None:
        """Fetch the current 5-min crypto up/down market from predict.fun.

        Calls ``GET /v1/markets?status=OPEN&marketVariant=CRYPTO_UP_DOWN``
        and filters results by the deterministic ``categorySlug``.

        Args:
            crypto: ticker — btc, eth, sol, etc.
            offset: 0 = current window, -1 = previous, +1 = next.

        Returns:
            The raw market dict from the API, or None if not found.
        """
        slug = self.get_category_slug(crypto, 5, offset)
        url = f"{self._predict.api_host}/v1/markets"
        params = {"status": "OPEN", "marketVariant": "CRYPTO_UP_DOWN"}
        headers: dict[str, str] = {}
        if self._predict.api_key:
            headers["x-api-key"] = self._predict.api_key

        logger.debug("Searching predict.fun for categorySlug=%s at %s", slug, url)

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, params=params, headers=headers, timeout=15)
                resp.raise_for_status()
        except httpx.RequestError as e:
            logger.error("Predict.fun API request failed: %s", e)
            return None
        except httpx.HTTPStatusError as e:
            logger.error("Predict.fun API returned %s: %s", e.response.status_code, e.response.text[:200])
            return None

        body = resp.json()
        markets: list[dict] = body.get("data", [])

        for market in markets:
            if market.get("categorySlug") == slug:
                logger.info("Found predict.fun market: id=%s title=%r", market.get("id"), market.get("title"))
                return market

        logger.warning("No predict.fun market found for categorySlug=%s (%d markets scanned)", slug, len(markets))
        return None
