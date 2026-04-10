"""
Kalshi REST API client.

Docs: https://trading-api.kalshi.com/trade-api/v2
Auth: RSA-signed requests. Each request needs a signature header.

Setup:
  1. Create API key at kalshi.com → Settings → API
  2. In .env, set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY (multiline, in double quotes):

     KALSHI_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
     MIIEpAIBAAK...
     -----END RSA PRIVATE KEY-----"
"""
import base64
import logging
import time
from typing import Optional

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logger = logging.getLogger(__name__)

BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"

# Series tickers for daily temperature markets (high / low per city)
WEATHER_SERIES = [
    "KXHIGHCHI", "KXHIGHNY", "KXHIGHMIA", "KXHIGHDEN", "KXHIGHTATL",
    "KXHIGHTSEA", "KXHIGHLAX", "KXHIGHHOU", "KXHIGHPHIL", "KXHIGHTSFO",
    "KXHIGHTLV", "KXLOWTCHI", "KXLOWTNYC", "KXLOWTDEN", "KXLOWTHOU",
    "KXLOWTPHX", "KXLOWTSEA", "KXLOWTBOS", "KXLOWTPHIL", "KXLOWTMIA",
]


class KalshiClient:
    def __init__(self, api_key_id: str, private_key_pem: str, dry_run: bool = True):
        self.api_key_id = api_key_id
        self.dry_run = dry_run
        self._private_key = self._load_private_key(private_key_pem)
        self._client = httpx.AsyncClient(base_url=BASE_URL, timeout=15.0)

    def _load_private_key(self, pem: str):
        # Handle literal \n escapes that some env loaders produce
        pem = pem.replace("\\n", "\n")
        return serialization.load_pem_private_key(pem.encode(), password=None)

    def _sign(self, method: str, path: str) -> dict:
        # Kalshi signing spec: timestamp_ms + METHOD + /trade-api/v2{path}
        # Body is NOT included. Path must include the /trade-api/v2 prefix.
        # Padding: RSA-PSS with SHA256 and DIGEST_LENGTH salt.
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

    async def get_weather_markets(self) -> list[dict]:
        """Fetch all open temperature markets across known weather series."""
        path = "/markets"
        all_markets = []
        for series in WEATHER_SERIES:
            headers = self._sign("GET", path)
            try:
                resp = await self._client.get(
                    path, headers=headers,
                    params={"status": "open", "series_ticker": series, "limit": 100},
                )
                resp.raise_for_status()
                all_markets.extend(resp.json().get("markets", []))
            except Exception as e:
                logger.warning(f"Failed to fetch markets for series {series}: {e}")
        return all_markets

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
            # Kalshi returns balance in cents
            return resp.json().get("balance", 0) / 100.0
        except Exception as e:
            logger.error(f"Failed to fetch balance: {e}")
            return 0.0

    async def place_order(
        self,
        ticker: str,
        side: str,       # 'yes' or 'no'
        contracts: int,
        price_cents: int,  # limit price in cents (1–99)
    ) -> Optional[dict]:
        """
        Place a limit order. Returns order dict or None.
        In dry_run mode: logs the intent but does not actually submit.
        """
        if self.dry_run:
            logger.info(
                f"[DRY RUN] Would place: {side.upper()} {contracts}x {ticker} "
                f"@ {price_cents}¢ (${price_cents * contracts / 100:.2f} total)"
            )
            return {"order_id": "dry-run", "status": "dry_run"}

        path = "/portfolio/orders"
        body_dict = {
            "ticker": ticker,
            "client_order_id": f"wa-{int(time.time())}",
            "type": "limit",
            "action": "buy",
            "side": side,
            "count": contracts,
            "yes_price" if side == "yes" else "no_price": price_cents,
        }
        import json
        body_str = json.dumps(body_dict)
        headers = self._sign("POST", path)
        try:
            resp = await self._client.post(path, content=body_str, headers=headers)
            resp.raise_for_status()
            return resp.json().get("order")
        except Exception as e:
            logger.error(f"Order placement failed for {ticker}: {e}")
            return None

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
