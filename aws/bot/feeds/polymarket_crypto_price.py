import logging
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://polymarket.com/api/crypto/crypto-price"

class PolymarketCryptoPrice:
    """
    Client for fetching the underlying asset's open/close prices directly
    from Polymarket's internal crypto-price API.
    
    This is often used by Polymarket's frontend to resolve five-minute
    markets based on exact time windows.
    """

    @classmethod
    async def get_price(
        self,
        symbol: str = "BTC",
        *,
        eventStartTime: str,
        variant: str = "fiveminute",
        endDate: str,
    ) -> dict[str, Any]:
        """
        Fetch the crypto price details for a given event window.

        Args:
            symbol: The asset ticker, e.g. "BTC" or "ETH".
            eventStartTime: ISO 8601 timestamp string for the window start (e.g., "2026-05-09T01:35:00Z").
            variant: The timeframe variant (e.g., "fiveminute", "hourly").
            endDate: ISO 8601 timestamp string for the window end (e.g., "2026-05-09T01:40:00Z").

        Returns:
            A dictionary containing the parsed JSON response:
            {
                "openPrice": float | None,
                "closePrice": float | None,
                "timestamp": int,
                "completed": bool,
                "incomplete": bool,
                "cached": bool
            }
        """
        params = {
            "symbol": symbol,
            "eventStartTime": eventStartTime,
            "variant": variant,
            "endDate": endDate,
        }

        # Polymarket APIs often require typical browser headers to not block the request
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(BASE_URL, params=params, headers=headers)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as exc:
            logger.error("Failed to fetch Polymarket crypto price for %s: %s", symbol, exc)
            return {}

    @classmethod
    async def get_open_price(self, slug: str) -> float | None:
        """
        Fetch the crypto open price using a Polymarket event slug.
        
        Example slug: 'btc-updown-5m-1778291400'
        """
        parts = slug.split("-")
        if len(parts) < 4:
            logger.warning("Invalid slug format: %s", slug)
            return None
            
        symbol = parts[0].upper()
        interval_str = parts[2]
        
        try:
            timestamp = int(parts[-1])
        except ValueError:
            logger.warning("Invalid timestamp in slug: %s", slug)
            return None
            
        # Determine duration in minutes and the correct variant string
        if interval_str.endswith('m'):
            try:
                minutes = int(interval_str[:-1])
            except ValueError:
                minutes = 5
        elif interval_str == "hourly":
            minutes = 60
        else:
            minutes = 5
            
        if minutes == 5:
            variant = "fiveminute"
        elif minutes == 60:
            variant = "hourly"
        else:
            variant_map = {1: "oneminute", 15: "fifteenminute", 30: "thirtyminute"}
            variant = variant_map.get(minutes, "fiveminute")
            
        # Format timestamps as ISO 8601 UTC strings
        start_dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        eventStartTime = start_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        end_timestamp = timestamp + (minutes * 60)
        end_dt = datetime.fromtimestamp(end_timestamp, tz=timezone.utc)
        endDate = end_dt.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        data = await self.get_price(
            symbol=symbol,
            eventStartTime=eventStartTime,
            variant=variant,
            endDate=endDate
        )
        
        return data.get("openPrice")
