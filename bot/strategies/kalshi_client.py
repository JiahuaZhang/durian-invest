"""
Kalshi REST API client — shared base for all Kalshi strategies.

Docs:  https://trading-api.kalshi.com/trade-api/v2
Auth:  RSA-PSS signed requests (no body in signature).

Setup:
  1. Create API key at kalshi.com → Settings → API
  2. In .env, set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY (multiline, in double quotes):

     KALSHI_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
     MIIEpAIBAAK...
     -----END RSA PRIVATE KEY-----"
"""
import base64
import json
import logging
import time
from typing import Optional

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logger = logging.getLogger(__name__)

PROD_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"
DEMO_BASE_URL = "https://demo-api.kalshi.co/trade-api/v2"
BASE_URL = PROD_BASE_URL  # backward-compat alias


class KalshiClient:
    def __init__(
        self,
        api_key_id: str,
        private_key_pem: str,
        dry_run: bool = True,
        base_url: str = BASE_URL,
    ):
        self.api_key_id = api_key_id
        self.dry_run = dry_run
        self._private_key = self._load_private_key(private_key_pem)
        self._client = httpx.AsyncClient(base_url=base_url, timeout=15.0)

    def _load_private_key(self, pem: str):
        # Handle literal \n escapes that some env loaders produce
        pem = pem.replace("\\n", "\n")
        return serialization.load_pem_private_key(pem.encode(), password=None)

    def _sign(self, method: str, path: str) -> dict:
        # Kalshi signing spec: timestamp_ms + METHOD + /trade-api/v2{path}
        # Body is NOT included. Padding: RSA-PSS with SHA256 and DIGEST_LENGTH salt.
        ts = str(int(time.time() * 1000))
        full_path = "/trade-api/v2" + path
        msg = ts + method.upper() + full_path
        signature = self._private_key.sign(
            msg.encode(),
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
            hashes.SHA256(),
        )
        sig_b64 = base64.b64encode(signature).decode()
        return {
            "KALSHI-ACCESS-KEY": self.api_key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": sig_b64,
            "Content-Type": "application/json",
        }

    async def close(self):
        await self._client.aclose()

    async def get_market(self, ticker: str) -> Optional[dict]:
        """Fetch a single market by ticker."""
        path = f"/markets/{ticker}"
        headers = self._sign("GET", path)
        try:
            resp = await self._client.get(path, headers=headers)
            resp.raise_for_status()
            return resp.json().get("market")
        except Exception as e:
            logger.error(f"Failed to fetch market {ticker}: {e}")
            return None

    async def get_balance(self) -> float:
        """Return available balance in USD."""
        path = "/portfolio/balance"
        headers = self._sign("GET", path)
        try:
            resp = await self._client.get(path, headers=headers)
            resp.raise_for_status()
            return resp.json().get("balance", 0) / 100.0
        except Exception as e:
            logger.error(f"Failed to fetch balance: {e}")
            return 0.0

    async def place_order(
        self,
        ticker: str,
        side: str,       # 'yes' | 'no'
        contracts: int,
        price_cents: int,  # limit price in cents (1–99)
        action: str = "buy",  # 'buy' | 'sell'
    ) -> Optional[dict]:
        """
        Place a limit order (buy or sell). Returns order dict or None.
        In dry_run mode: logs the intent but does not submit.
        """
        if self.dry_run:
            logger.info(
                f"[DRY RUN] {action.upper()} {side.upper()} {contracts}x {ticker} "
                f"@ {price_cents}¢ (${price_cents * contracts / 100:.2f} total)"
            )
            return {"order_id": f"dry-run-{int(time.time())}", "status": "dry_run"}

        path = "/portfolio/orders"
        body = {
            "ticker": ticker,
            "client_order_id": f"kal-{int(time.time() * 1000)}",
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
        """Cancel an open order by ID."""
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

    async def get_open_positions(self) -> list[dict]:
        """Return all open positions."""
        path = "/portfolio/positions"
        headers = self._sign("GET", path)
        try:
            resp = await self._client.get(path, headers=headers)
            resp.raise_for_status()
            return resp.json().get("market_positions", [])
        except Exception as e:
            logger.error(f"Failed to fetch positions: {e}")
            return []
