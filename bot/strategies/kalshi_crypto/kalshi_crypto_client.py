"""
KalshiCryptoClient — thin extension of KalshiClient for crypto markets.

Adds get_markets() with two normalizations the base client doesn't need:
  1. Filters out markets where open_time is in the future (status="initialized"
     markets Kalshi incorrectly returns for status=open queries).
  2. Derives yes_ask/yes_bid/no_ask/no_bid integer-cent fields from the
     yes_ask_dollars/... dollar-string fields the v2 API actually returns.
"""
import logging
from datetime import datetime, timezone

from ..kalshi_client import KalshiClient, PROD_BASE_URL, DEMO_BASE_URL

logger = logging.getLogger(__name__)


class KalshiCryptoClient(KalshiClient):
    def __init__(self, api_key_id: str, private_key: str, use_demo: bool = False):
        base_url = DEMO_BASE_URL if use_demo else PROD_BASE_URL
        env_tag = "DEMO" if use_demo else "PROD"
        logger.info(f"KalshiCryptoClient connecting to {env_tag}: {base_url}")
        super().__init__(api_key_id, private_key, dry_run=False, base_url=base_url)

    async def get_markets(self, series_ticker: str, limit: int = 50) -> list[dict]:
        """
        Fetch currently-trading markets for a series.

        Kalshi's status=open query also returns status=initialized markets whose
        open_time is in the future — those are pre-created but not yet live.
        We drop them here so the strategy only sees markets with an active book.

        Prices in the v2 API come as dollar strings (yes_ask_dollars="0.9200").
        We add yes_ask/yes_bid/no_ask/no_bid as integer cents so the rest of the
        code doesn't have to know about the wire format.
        """
        path = "/markets"
        try:
            resp = await self._client.get(
                path,
                params={"status": "open", "series_ticker": series_ticker, "limit": limit},
            )
            resp.raise_for_status()
            raw = resp.json().get("markets", [])
        except Exception as e:
            logger.error(f"Failed to fetch markets for {series_ticker}: {e}")
            return []

        now = datetime.now(timezone.utc)
        result = []
        for m in raw:
            open_time_raw = m.get("open_time", "")
            if open_time_raw:
                try:
                    if datetime.fromisoformat(open_time_raw.replace("Z", "+00:00")) > now:
                        continue
                except Exception:
                    pass
            result.append(self._normalize(m))

        return result

    async def get_market(self, ticker: str):
        m = await super().get_market(ticker)
        return self._normalize(m) if m else None

    @staticmethod
    def _normalize(m: dict) -> dict:
        """Derive yes_ask/yes_bid/no_ask/no_bid integer-cent fields from dollar strings."""
        for side in ("yes", "no"):
            for action in ("ask", "bid"):
                dollars_key = f"{side}_{action}_dollars"
                cents_key = f"{side}_{action}"
                if dollars_key in m and cents_key not in m:
                    try:
                        m[cents_key] = round(float(m[dollars_key]) * 100)
                    except (ValueError, TypeError):
                        m[cents_key] = 100 if action == "ask" else 0
        return m
