"""
KalshiCryptoClient — thin extension of KalshiClient for crypto markets.
Adds: get_markets, cancel_order, and sell-side order support.
No price feeds — Kalshi orderbook only.
"""
import json
import logging
import time
from typing import Optional

from ..kalshi_client import KalshiClient, PROD_BASE_URL, DEMO_BASE_URL

logger = logging.getLogger(__name__)


class KalshiCryptoClient(KalshiClient):
    def __init__(self, api_key_id: str, private_key: str, use_demo: bool = False):
        base_url = DEMO_BASE_URL if use_demo else PROD_BASE_URL
        env_tag = "DEMO" if use_demo else "PROD"
        logger.info(f"KalshiCryptoClient connecting to {env_tag}: {base_url}")
        super().__init__(api_key_id, private_key, dry_run=False, base_url=base_url)

    async def get_markets(self, series_ticker: str, limit: int = 50) -> list[dict]:
        """Fetch open markets for a series. Public endpoint — no auth required."""
        path = "/markets"
        try:
            resp = await self._client.get(
                path,
                params={"status": "open", "series_ticker": series_ticker, "limit": limit},
            )
            resp.raise_for_status()
            return resp.json().get("markets", [])
        except Exception as e:
            logger.error(f"Failed to fetch markets for {series_ticker}: {e}")
            return []

    async def place_order(
        self,
        ticker: str,
        side: str,          # 'yes' | 'no'
        contracts: int,
        price_cents: int,   # limit price 1–99
        action: str = "buy",  # 'buy' | 'sell'
    ) -> Optional[dict]:
        """Place a limit order. Supports both buy and sell actions."""
        if self.dry_run:
            logger.info(
                f"[DRY RUN] {action.upper()} {side.upper()} {contracts}x {ticker} @ {price_cents}¢"
            )
            return {"order_id": f"dry-run-{int(time.time())}", "status": "dry_run"}

        path = "/portfolio/orders"
        body = {
            "ticker": ticker,
            "client_order_id": f"btc-{int(time.time() * 1000)}",
            "type": "limit",
            "action": action,
            "side": side,
            "count": contracts,
            "yes_price" if side == "yes" else "no_price": price_cents,
        }
        headers = self._sign("POST", path)
        try:
            resp = await self._client.post(path, content=json.dumps(body), headers=headers)
            resp.raise_for_status()
            return resp.json().get("order")
        except Exception as e:
            logger.error(f"Order {action} {side} failed for {ticker}: {e}")
            return None

    async def cancel_order(self, order_id: str) -> bool:
        if self.dry_run:
            logger.info(f"[DRY RUN] Would cancel order {order_id}")
            return True
        path = f"/portfolio/orders/{order_id}"
        headers = self._sign("DELETE", path)
        try:
            resp = await self._client.delete(path, headers=headers)
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"Failed to cancel order {order_id}: {e}")
            return False
