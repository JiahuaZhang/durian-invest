"""
Weather-specific Kalshi client.

Extends the shared KalshiClient base with get_weather_markets(),
which fans out across all known temperature series tickers.
"""
import logging

from ..kalshi_client import KalshiClient  # noqa: F401 — re-exported for existing callers

logger = logging.getLogger(__name__)

# Series tickers for daily temperature markets (high / low per city)
WEATHER_SERIES = [
    "KXHIGHCHI", "KXHIGHNY",  "KXHIGHMIA", "KXHIGHDEN", "KXHIGHTATL",
    "KXHIGHTSEA","KXHIGHLAX", "KXHIGHHOU", "KXHIGHPHIL","KXHIGHTSFO",
    "KXHIGHTLV", "KXLOWTCHI", "KXLOWTNYC", "KXLOWTDEN", "KXLOWTHOU",
    "KXLOWTPHX", "KXLOWTSEA", "KXLOWTBOS", "KXLOWTPHIL","KXLOWTMIA",
]


class WeatherKalshiClient(KalshiClient):
    async def get_weather_markets(self) -> list[dict]:
        """Fetch all open temperature markets across all known weather series."""
        path = "/markets"
        all_markets = []
        for series in WEATHER_SERIES:
            headers = self._sign("GET", path)
            try:
                resp = await self._client.get(
                    path,
                    headers=headers,
                    params={"status": "open", "series_ticker": series, "limit": 100},
                )
                resp.raise_for_status()
                all_markets.extend(resp.json().get("markets", []))
            except Exception as e:
                logger.warning(f"Failed to fetch markets for series {series}: {e}")
        return all_markets
