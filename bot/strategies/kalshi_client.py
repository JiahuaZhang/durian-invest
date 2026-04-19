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
import uuid
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
        base_url: str = BASE_URL,
        subaccount: int = 0,
    ):
        self.api_key_id = api_key_id
        self.subaccount = subaccount  # 0 = primary, 1-32 = subaccounts
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

    # ── Market ────────────────────────────────────────────────────────────────

    async def get_market(self, ticker: str) -> Optional[dict]:
        path = f"/markets/{ticker}"
        try:
            resp = await self._client.get(path)
            resp.raise_for_status()
            return resp.json().get("market")
        except Exception as e:
            logger.error(f"Failed to fetch market {ticker}: {e}")
            return None

    # ── Portfolio ─────────────────────────────────────────────────────────────

    async def get_balance(self, subaccount: int = None) -> float:
        """Return available balance in USD for the primary account."""
        path = "/portfolio/balance"
        headers = self._sign("GET", path)
        params = {"subaccount": subaccount if isinstance(subaccount, int) else self.subaccount}
        try:
            resp = await self._client.get(path, headers=headers, params=params)
            resp.raise_for_status()
            return resp.json().get("balance", 0) / 100.0
        except Exception as e:
            logger.error(f"Failed to fetch balance: {e}")
            return 0.0

    async def get_open_positions(self, subaccount: int = None) -> list[dict]:
        """Return all open positions for the given subaccount (default: self.subaccount)."""
        path = "/portfolio/positions"
        headers = self._sign("GET", path)
        params = {"subaccount": subaccount if isinstance(subaccount, int) else self.subaccount}
        try:
            resp = await self._client.get(path, headers=headers, params=params)
            resp.raise_for_status()
            return resp.json().get("market_positions", [])
        except Exception as e:
            logger.error(f"Failed to fetch positions: {e}")
            return []

    async def place_order(
        self,
        ticker: str,
        side: str,       # 'yes' | 'no'
        action: str,     # 'buy' | 'sell'
        count: int,
        yes_price: int = None,
        no_price: int = None,
        yes_price_dollars: str = None,
        no_price_dollars: str = None,
        subaccount: int = None,
    ) -> Optional[dict]:
        """Place a limit order. Uses self.subaccount by default."""
        path = "/portfolio/orders"
        body = {
            "ticker": ticker,
            "side": side,
            "action": action,
            "count": count,
            "type": "limit",
            "yes_price": yes_price,
            "no_price": no_price,
            "yes_price_dollars": yes_price_dollars,
            "no_price_dollars": no_price_dollars,
            "subaccount": subaccount if isinstance(subaccount, int) else self.subaccount
        }
        headers = self._sign("POST", path)
        try:
            resp = await self._client.post(path, content=json.dumps(body), headers=headers)
            resp.raise_for_status()
            return resp.json().get("order")
        except Exception as e:
            logger.error(f"Order {action} {side} failed for {ticker}: {e}")
            return None

    async def get_order(self, order_id: str) -> Optional[dict]:
        path = f"/portfolio/orders/{order_id}"
        headers = self._sign("GET", path)
        try:
            resp = await self._client.get(path, headers=headers)
            resp.raise_for_status()
            return resp.json().get("order")
        except Exception as e:
            logger.error(f"Failed to fetch order {order_id}: {e}")
            return None

    async def cancel_order(self, order_id: str, subaccount: int = None) -> bool:
        """Cancel an open order by ID."""
        path = f"/portfolio/orders/{order_id}"
        headers = self._sign("DELETE", path)
        params = {"subaccount": subaccount if isinstance(subaccount, int) else self.subaccount}
        try:
            resp = await self._client.delete(path, headers=headers, params=params)
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"Failed to cancel order {order_id}: {e}")
            return False

    # ── Subaccount helpers (manual use only — not called by the bot) ──────────

    async def get_subaccount_balances(self) -> list[dict]:
        """
        Return balances for all subaccounts.

        Each entry: {"subaccount_number": int, "balance": "$X.XXXXXX", "updated_ts": int}
        subaccount_number 0 = primary account.

        Example:
            client = KalshiCryptoClient(key_id, private_key)
            balances = await client.get_subaccount_balances()
            for b in balances:
                print(b["subaccount_number"], b["balance"])
            await client.close()
        """
        path = "/portfolio/subaccounts/balances"
        headers = self._sign("GET", path)
        try:
            resp = await self._client.get(path, headers=headers)
            resp.raise_for_status()
            return resp.json().get("subaccounts", [])
        except Exception as e:
            logger.error(f"Failed to fetch subaccount balances: {e}")
            return []

    async def create_subaccount(self) -> Optional[int]:
        """
        Create a new subaccount. Returns the new subaccount_number (1-32), or None on failure.
        Kalshi allows a maximum of 32 subaccounts, numbered sequentially.

        Example:
            client = KalshiCryptoClient(key_id, private_key)
            number = await client.create_subaccount()
            print(f"Created subaccount #{number}")
            await client.close()
        """
        path = "/portfolio/subaccounts"
        headers = self._sign("POST", path)
        try:
            resp = await self._client.post(path, headers=headers)
            resp.raise_for_status()
            number = resp.json().get("subaccount_number")
            logger.info(f"Created subaccount #{number}")
            return number
        except Exception as e:
            logger.error(f"Failed to create subaccount: {e}")
            return None

    async def transfer_funds(
        self,
        from_subaccount: int,
        to_subaccount: int,
        amount_cents: int,
        client_transfer_id: str = None,
    ) -> bool:
        """
        Transfer funds between subaccounts (0 = primary, 1-32 = subaccounts).
        amount_cents is in cents: 10000 = $100.00.
        Returns True on success.

        Example — move $50 from primary to subaccount #1:
            client = KalshiCryptoClient(key_id, private_key)
            ok = await client.transfer_funds(from_subaccount=0, to_subaccount=1, amount_cents=5000)
            print("transferred" if ok else "failed")
            await client.close()
        """
        path = "/portfolio/subaccounts/transfer"
        body = {
            "client_transfer_id": client_transfer_id or str(uuid.uuid4()),
            "from_subaccount": from_subaccount,
            "to_subaccount": to_subaccount,
            "amount_cents": amount_cents,
        }
        headers = self._sign("POST", path)
        try:
            resp = await self._client.post(path, content=json.dumps(body), headers=headers)
            resp.raise_for_status()
            logger.info(
                f"Transferred {amount_cents}¢ (${amount_cents/100:.2f}) "
                f"from subaccount #{from_subaccount} → #{to_subaccount}"
            )
            return True
        except Exception as e:
            logger.error(f"Transfer failed ({from_subaccount}→{to_subaccount}, {amount_cents}¢): {e}")
            return False
