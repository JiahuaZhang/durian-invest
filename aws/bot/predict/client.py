"""
Predict.fun crypto up/down market lookup.

Fetches OPEN CRYPTO_UP_DOWN markets from the predict.fun REST API
and filters by the deterministic categorySlug pattern to find the
current 5-min window market.

API reference: https://dev.predict.fun/get-markets-25326905e0
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any

import httpx

from eth_account import Account
from eth_account.messages import encode_defunct

from ..config import BotConfig, PredictConfig

logger = logging.getLogger(__name__)


class PredictClient:
    """Client for predict.fun market lookups and authenticated trading."""

    def __init__(self, cfg: BotConfig) -> None:
        self._cfg = cfg
        self._predict = cfg.predict
        self._jwt: str | None = None
        self._jwt_expires_at: float = 0
        
        # Determine the wallet address if private key is provided
        self._account = None
        private_key = cfg.predict.private_key
        if private_key:
            try:
                self._account = Account.from_key(private_key)
            except Exception as e:
                logger.error("Failed to parse predict private key: %s", e)

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
        and paginates through all pages to find the market matching
        the deterministic ``categorySlug``.

        Args:
            crypto: ticker — btc, eth, sol, etc.
            offset: 0 = current window, -1 = previous, +1 = next.

        Returns:
            The raw market dict from the API, or None if not found.
        """
        slug = self.get_category_slug(crypto, 5, offset)
        url = f"{self._predict.api_host}/v1/markets"
        params: dict[str, str | int] = {
            "status": "OPEN",
            "marketVariant": "CRYPTO_UP_DOWN",
            "first": 100,
            "sort": "VOLUME_TOTAL_DESC"
        }
        headers: dict[str, str] = {}
        if self._predict.credentials:
            headers["x-api-key"] = self._predict.credentials

        logger.debug("Searching predict.fun for categorySlug=%s at %s", slug, url)

        total_scanned = 0
        max_pages = 10

        try:
            async with httpx.AsyncClient() as client:
                for page in range(max_pages):
                    resp = await client.get(url, params=params, headers=headers, timeout=15)
                    resp.raise_for_status()

                    body = resp.json()
                    markets: list[dict] = body.get("data", [])
                    total_scanned += len(markets)

                    for market in markets:
                        if market.get("categorySlug") == slug:
                            logger.info("Found predict.fun market: id=%s title=%r (page %d)", market.get("id"), market.get("title"), page + 1)
                            return market

                    cursor = body.get("cursor")
                    if not cursor or not markets:
                        break
                    params["after"] = cursor

        except httpx.RequestError as e:
            logger.error("Predict.fun API request failed: %s", e)
            return None
        except httpx.HTTPStatusError as e:
            logger.error("Predict.fun API returned %s: %s", e.response.status_code, e.response.text[:200])
            return None

        logger.warning("No predict.fun market found for categorySlug=%s (%d markets scanned)", slug, total_scanned)
        return None

    async def get_market(self, market_id: str | int) -> dict | None:
        """Fetch a specific market by ID.

        Calls ``GET /v1/markets/{market_id}``
        """
        url = f"{self._predict.api_host}/v1/markets/{market_id}"
        headers: dict[str, str] = {}
        if self._predict.credentials:
            headers["x-api-key"] = self._predict.credentials
        
        logger.debug("Fetching predict.fun market id=%s at %s", market_id, url)
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, headers=headers, timeout=15)
                resp.raise_for_status()
                
                body = resp.json()
                return body.get("data")
        except httpx.RequestError as e:
            logger.error("Predict.fun API request failed: %s", e)
        except httpx.HTTPStatusError as e:
            logger.error("Predict.fun API returned %s: %s", e.response.status_code, e.response.text[:200])
            
        return None

    async def get_jwt(self, force_refresh: bool = False) -> str | None:
        """Get a JWT token for authenticated requests, cached in-memory.
        Tokens are valid for 24 hours; we refresh if less than 5 minutes remain.
        """
        if self._jwt and not force_refresh and time.time() < self._jwt_expires_at:
            return self._jwt
        
        if not self._account:
            logger.error("Cannot get predict.fun JWT without a private key.")
            return None
            
        try:
            async with httpx.AsyncClient() as client:
                # 1. Get Auth Message
                msg_url = f"{self._predict.api_host}/v1/auth/message"
                headers = {}
                if self._predict.credentials:
                    headers["x-api-key"] = self._predict.credentials
                resp_msg = await client.get(msg_url, headers=headers, timeout=10)
                resp_msg.raise_for_status()
                auth_message = resp_msg.json().get("data", {}).get("message")
                
                if not auth_message:
                    logger.error("No auth message returned from predict.fun")
                    return None
                    
                # 2. Sign Message
                msg = encode_defunct(text=auth_message)
                signed = self._account.sign_message(msg)
                signature = "0x" + signed.signature.hex()
                
                # 3. Get JWT
                auth_url = f"{self._predict.api_host}/v1/auth"
                payload = {
                    "signer": self._account.address,
                    "signature": signature,
                    "message": auth_message
                }
                resp_auth = await client.post(auth_url, headers=headers, json=payload, timeout=10)
                resp_auth.raise_for_status()
                
                token = resp_auth.json().get("data", {}).get("token")
                if token:
                    self._jwt = token
                    try:
                        # Decode the JWT payload to find 'exp'
                        payload_b64 = token.split('.')[1]
                        payload_b64 += '=' * (-len(payload_b64) % 4)
                        payload = json.loads(base64.urlsafe_b64decode(payload_b64).decode())
                        self._jwt_expires_at = float(payload.get("exp", time.time() + 86400))
                    except Exception as e:
                        logger.warning("Failed to decode JWT to find expiration, defaulting to 24h: %s", e)
                        self._jwt_expires_at = time.time() + 86400
                        
                    logger.info("Successfully authenticated with predict.fun")
                    return token
                else:
                    logger.error("No token in predict.fun auth response")
                    return None
        except Exception as e:
            logger.error("Failed to authenticate with predict.fun: %s", e)
            return None

    async def create_order(self, order_payload: dict[str, Any]) -> dict | None:
        """Create an order on predict.fun."""
        jwt = await self.get_jwt()
        if not jwt:
            return None
            
        url = f"{self._predict.api_host}/v1/orders"
        headers = {
            "Authorization": f"Bearer {jwt}",
            "Content-Type": "application/json"
        }
        if self._predict.credentials:
            headers["x-api-key"] = self._predict.credentials
        
        try:
            async with httpx.AsyncClient() as client:
                # The endpoint expects {"data": {...}} payload
                resp = await client.post(url, headers=headers, json={"data": order_payload}, timeout=15)
                resp.raise_for_status()
                return resp.json().get("data")
        except httpx.HTTPStatusError as e:
            logger.error("Predict.fun create order failed: %s %s", e.response.status_code, e.response.text[:200])
        except Exception as e:
            logger.error("Predict.fun create order error: %s", e)
            
        return None

    async def cancel_orders(self, ids: list[str]) -> dict | None:
        """Remove orders from the orderbook."""
        jwt = await self.get_jwt()
        if not jwt:
            return None
            
        url = f"{self._predict.api_host}/v1/orders/remove"
        headers = {
            "Authorization": f"Bearer {jwt}",
            "Content-Type": "application/json"
        }
        if self._predict.credentials:
            headers["x-api-key"] = self._predict.credentials
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, headers=headers, json={"data": {"ids": ids}}, timeout=15)
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error("Predict.fun cancel orders failed: %s %s", e.response.status_code, e.response.text[:200])
        except Exception as e:
            logger.error("Predict.fun cancel orders error: %s", e)
            
        return None

    @staticmethod
    async def get_start_price(crypto: str = "btc", offset: int = 0) -> float | None:
            """Fetch the start price of a 5-min crypto up/down market via GraphQL.

            Calls POST https://graphql.predict.fun/graphql to fetch the startPrice 
            using the dynamically generated categoryId (slug).

            Args:
                crypto: ticker — btc, eth, sol, etc.
                offset: 0 = current window, -1 = previous, +1 = next.

            Returns:
                The start price as a float, or None if not found/error.
            """
            slug = PredictClient.get_category_slug(crypto, 5, offset)
            url = "https://graphql.predict.fun/graphql"
            
            payload = {
                "query": (
                    "query GetCategoryStartPrice($categoryId: ID!) {\n"
                    "  category(id: $categoryId) {\n"
                    "    __typename\n"
                    "    ... on CryptoUpDownCategory {\n"
                    "      marketData {\n"
                    "        startPrice\n"
                    "      }\n"
                    "    }\n"
                    "  }\n"
                    "}"
                ),
                "variables": {
                    "categoryId": slug
                },
                "operationName": "GetCategoryStartPrice"
            }
            
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            }

            logger.debug("Fetching predict.fun startPrice for categoryId=%s via GraphQL", slug)

            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.post(url, json=payload, headers=headers, timeout=15)
                    resp.raise_for_status()
            except httpx.RequestError as e:
                logger.error("Predict.fun GraphQL request failed: %s", e)
                return None
            except httpx.HTTPStatusError as e:
                logger.error("Predict.fun GraphQL returned %s: %s", e.response.status_code, e.response.text[:200])
                return None

            body = resp.json()
            
            # Safely parse the deeply nested response
            try:
                category = body.get("data", {}).get("category")
                if not category:
                    logger.warning("No category found in GraphQL response for categoryId=%s", slug)
                    return None
                    
                market_data = category.get("marketData", [])
                if not market_data:
                    logger.warning("No marketData found in GraphQL response for categoryId=%s", slug)
                    return None
                    
                start_price = market_data[0].get("startPrice")
                if start_price is not None:
                    logger.info("Found start price for %s: %s", slug, start_price)
                    return float(start_price)
                else:
                    logger.warning("startPrice is missing in marketData for categoryId=%s", slug)
                    return None
                    
            except Exception as e:
                logger.error("Failed to parse predict.fun GraphQL response: %s", e)
                return None