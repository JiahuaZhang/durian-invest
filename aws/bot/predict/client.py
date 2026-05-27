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
import secrets
import time
from decimal import ROUND_CEILING, Decimal
from typing import Any

import httpx

from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data

from ..config import BotConfig, PredictConfig

logger = logging.getLogger(__name__)

PREDICT_PROTOCOL_NAME = "predict.fun CTF Exchange"
PREDICT_PROTOCOL_VERSION = "1"
PREDICT_PRECISION = 10**18
PREDICT_MAX_SALT = 2_147_483_648
PREDICT_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
PREDICT_LIMIT_ORDER_EXPIRATION = 4102444800  # 2100-01-01T00:00:00Z
PREDICT_MIN_ORDER_VALUE = Decimal("0.90")

PREDICT_CHAIN_ID_MAINNET = 56
PREDICT_CHAIN_ID_TESTNET = 97

# Mirrors @predictdotfun/sdk v1.3.x AddressesByChainId. The EIP-712
# verifying contract changes with both network and market type.
PREDICT_EXCHANGE_BY_CHAIN_ID: dict[int, dict[tuple[bool, bool], str]] = {
    PREDICT_CHAIN_ID_MAINNET: {
        (False, False): "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689",
        (True, False): "0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A",
        (False, True): "0x6bEb5a40C032AFc305961162d8204CDA16DECFa5",
        (True, True): "0x8A289d458f5a134bA40015085A8F50Ffb681B41d",
    },
    PREDICT_CHAIN_ID_TESTNET: {
        (False, False): "0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7",
        (True, False): "0xd690b2bd441bE36431F6F6639D7Ad351e7B29680",
        (False, True): "0x8a6B4Fa700A1e310b106E7a48bAFa29111f66e89",
        (True, True): "0x95D5113bc50eD201e319101bbca3e0E250662fCC",
    },
}

PREDICT_ORDER_TYPES = {
    "EIP712Domain": [
        {"name": "name", "type": "string"},
        {"name": "version", "type": "string"},
        {"name": "chainId", "type": "uint256"},
        {"name": "verifyingContract", "type": "address"},
    ],
    "Order": [
        {"name": "salt", "type": "uint256"},
        {"name": "maker", "type": "address"},
        {"name": "signer", "type": "address"},
        {"name": "taker", "type": "address"},
        {"name": "tokenId", "type": "uint256"},
        {"name": "makerAmount", "type": "uint256"},
        {"name": "takerAmount", "type": "uint256"},
        {"name": "expiration", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "feeRateBps", "type": "uint256"},
        {"name": "side", "type": "uint8"},
        {"name": "signatureType", "type": "uint8"},
    ],
}


def _to_wei(value: float | int | str | Decimal) -> int:
    return int(Decimal(str(value)) * Decimal(PREDICT_PRECISION))


def _retain_significant_digits(num: int, significant_digits: int) -> int:
    if num == 0:
        return 0

    sign = -1 if num < 0 else 1
    abs_num = abs(num)
    excess = len(str(abs_num)) - significant_digits
    if excess <= 0:
        return num

    divisor = 10**excess
    return sign * ((abs_num // divisor) * divisor)


def get_minimum_order_size(
    price: float | int | str | Decimal,
    min_order_value: float | int | str | Decimal = PREDICT_MIN_ORDER_VALUE,
) -> Decimal:
    price_wei = _retain_significant_digits(_to_wei(price), 3)
    effective_price = Decimal(price_wei) / Decimal(PREDICT_PRECISION)
    if effective_price <= 0:
        raise ValueError(f"Predict.fun order price must be positive, got {price!r}")

    min_value = Decimal(str(min_order_value))
    if min_value <= 0:
        raise ValueError(f"Predict.fun minimum order value must be positive, got {min_order_value!r}")

    return (min_value / effective_price).to_integral_value(rounding=ROUND_CEILING)


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

    def _http_client(self) -> httpx.AsyncClient:
        """Build an HTTP client, opting into proxy only for restricted endpoints."""
        return httpx.AsyncClient(proxy=self._cfg.httpx_proxy if self._cfg.use_proxy else None)

    @staticmethod
    def minimum_order_size(
        price: float | int | str | Decimal,
        min_order_value: float | int | str | Decimal = PREDICT_MIN_ORDER_VALUE,
    ) -> Decimal:
        """Return the smallest whole-share order size that passes Predict's minimum."""
        return get_minimum_order_size(price, min_order_value)

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
            "sort": "VOLUME_24H_CHANGE_DESC"
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

    async def create_order(
        self,
        order_payload: dict[str, Any],
        *,
        return_full_response: bool = False,
    ) -> dict | None:
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
            async with self._http_client() as client:
                # The endpoint expects {"data": {...}} payload
                resp = await client.post(url, headers=headers, json={"data": order_payload}, timeout=15)
                resp.raise_for_status()
                body = resp.json()
                return body if return_full_response else body.get("data")
        except httpx.HTTPStatusError as e:
            logger.error("Predict.fun create order failed: %s %s", e.response.status_code, e.response.text)
            raise e
        except Exception as e:
            logger.error("Predict.fun create order error: %s", e)
            raise e

    async def get_order_by_hash(
        self,
        order_hash: str,
        return_full_response: bool = True,
    ) -> dict | None:
        """Fetch an order by its hash from Predict API.

        Calls ``GET /v1/orders/{hash}``

        The endpoint requires JWT authentication and retrieves order information 
        for one of your own orders by its hash.

        Successful Response Structure:
        - `id` (str): Internal Predict order ID
        - `marketId` (int): Market the order belongs to
        - `currency` (str): Currency used (e.g., "USDC")
        - `amount` (str): Total order size
        - `amountFilled` (str): Amount of the order that has been filled so far. 
            Yes, orders can be partially filled. If `amountFilled` > 0 but < `amount`, 
            it's a partial fill.
        - `isNegRisk` (bool), `isYieldBearing` (bool): Market details
        - `strategy` (str): "LIMIT" or "MARKET"
        - `status` (str): Current status of the order. Possible values:
            - `OPEN`: Order is placed and resting on the orderbook. May be partially filled.
            - `FILLED`: Order is completely filled.
            - `EXPIRED`: Order reached its expiration timestamp without being completely filled.
            - `CANCELLED`: Order was manually cancelled.
            - `INVALIDATED`: Order is no longer valid (e.g., insufficient funds).
        - `rewardEarningRate` (float): Associated rewards earning rate.
        - `order` (dict): The original order payload (maker, taker, signature, expiration, etc.)

        Typical Time to Fill:
        - Fill times depend entirely on market conditions (liquidity, price action). 
        - For latency arbitrage bots, if the target price is already crossed by the book, 
          the order typically fills instantly as the transaction goes on-chain (usually seconds on Predict). 
        - If the price is deeper in the book, it rests (`OPEN`) until matched.

        Possible Errors:
        - 400 Bad Request: Usually if the hash format is incorrect.
        - 401/403 Unauthorized: JWT is missing, invalid, or expired.
        - 404 Not Found: Order hash does not exist or doesn't belong to the authenticated user.

        Example Real Successful Response (dict):
        {
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "marketId": 1234,
            "currency": "USDC",
            "amount": "10000000000000000000",        # 10 shares
            "amountFilled": "5000000000000000000",  # 5 shares filled (Partial Fill)
            "isNegRisk": False,
            "isYieldBearing": False,
            "strategy": "LIMIT",
            "status": "OPEN",
            "rewardEarningRate": 0.0,
            "order": {
                "hash": "0x123abc...",
                "salt": "843920...",
                "maker": "0xYourAddress...",
                "signer": "0xYourAddress...",
                "taker": "0x0000000000000000000000000000000000000000",
                "tokenId": "123456789",
                "makerAmount": "10000000000000000000",
                "takerAmount": "5000000000000000000",
                "expiration": "1735689600",
                "nonce": "0",
                "feeRateBps": "200",
                "side": 0,
                "signatureType": 0,
                "signature": "0xabc..."
            }
        }
        """
        jwt = await self.get_jwt()
        if not jwt:
            logger.error("Cannot fetch order: Authentication failed.")
            return None
            
        url = f"{self._predict.api_host}/v1/orders/{order_hash}"
        headers = {
            "Authorization": f"Bearer {jwt}",
        }
        if self._predict.credentials:
            headers["x-api-key"] = self._predict.credentials
            
        try:
            async with self._http_client() as client:
                resp = await client.get(url, headers=headers, timeout=15)
                resp.raise_for_status()
                body = resp.json()
                return body if return_full_response else body.get("data")
        except httpx.HTTPStatusError as e:
            logger.error("Predict.fun get order by hash failed: %s %s", e.response.status_code, e.response.text)
            raise e
        except Exception as e:
            logger.error("Predict.fun get order by hash error: %s", e)
            raise e

    @staticmethod
    def _find_outcome(market: dict[str, Any], outcome_name: str) -> dict[str, Any]:
        """Find an outcome by name (e.g. 'Up', 'Down') in a market dict."""
        for outcome in market.get("outcomes", []):
            if outcome.get("name", "").lower() == outcome_name.lower():
                return outcome
        available = [o.get("name") for o in market.get("outcomes", [])]
        raise ValueError(f"Outcome {outcome_name!r} not found in market {market.get('id')}. Available: {available}")

    async def place_limit_order(
        self,
        market: dict[str, Any],
        outcome_name: str,
        side: str,
        price: float | int | str | Decimal,
        size: float | int | str | Decimal,
        is_post_only: bool = False,
        return_full_response: bool = False,
        expiration: int | None = None,
    ) -> dict | None:
        """Place a limit order by building and signing the required EIP-712 payload.

        All market metadata (feeRateBps, isNegRisk, isYieldBearing, tokenId)
        is derived from the *market* dict, so callers don't need to pass them.
        """
        if not self._account:
            logger.error("Cannot place order: No private key configured.")
            return None

        outcome = self._find_outcome(market, outcome_name)
        token_id = outcome["onChainId"]
        fee_rate_bps = int(market.get("feeRateBps", 200))
        is_neg_risk = bool(market.get("isNegRisk", False))
        is_yield_bearing = bool(market.get("isYieldBearing", False))

        chain_id = PREDICT_CHAIN_ID_TESTNET if self._predict.is_test else PREDICT_CHAIN_ID_MAINNET
        exchange_contract = PREDICT_EXCHANGE_BY_CHAIN_ID[chain_id][(is_neg_risk, is_yield_bearing)]

        # Match the Predict SDK's LIMIT amount helper: 18-decimal inputs,
        # price truncated to 3 significant digits, quantity to 5.
        price_wei = _retain_significant_digits(_to_wei(price), 3)
        qty_wei = _retain_significant_digits(_to_wei(size), 5)
        if qty_wei < 10**16:
            raise ValueError("Predict.fun limit order size must be at least 0.01 shares.")
        
        if side.upper() == "BUY":
            maker_amount = (price_wei * qty_wei) // PREDICT_PRECISION
            taker_amount = qty_wei
            order_side = 0
        elif side.upper() == "SELL":
            maker_amount = qty_wei
            taker_amount = (price_wei * qty_wei) // PREDICT_PRECISION
            order_side = 1
        else:
            raise ValueError(f"Invalid side {side}")

        salt = secrets.randbelow(PREDICT_MAX_SALT + 1)
        exp_time = expiration if expiration is not None else PREDICT_LIMIT_ORDER_EXPIRATION

        domain = {
            "name": PREDICT_PROTOCOL_NAME,
            "version": PREDICT_PROTOCOL_VERSION,
            "chainId": chain_id,
            "verifyingContract": exchange_contract
        }

        message = {
            "salt": salt,
            "maker": self._account.address,
            "signer": self._account.address,
            "taker": PREDICT_ZERO_ADDRESS,
            "tokenId": int(token_id),
            "makerAmount": maker_amount,
            "takerAmount": taker_amount,
            "expiration": exp_time,
            "nonce": 0,
            "feeRateBps": fee_rate_bps,
            "side": order_side,
            "signatureType": 0
        }

        encoded = encode_typed_data(
            full_message={
                "domain": domain,
                "types": PREDICT_ORDER_TYPES,
                "primaryType": "Order",
                "message": message
            }
        )

        signed_order = self._account.sign_message(encoded)
        order_hash = "0x" + signed_order.message_hash.hex()
        signature = "0x" + signed_order.signature.hex()

        order_payload = {
            "pricePerShare": str(price_wei),
            "strategy": "LIMIT",
            "order": {
                "salt": str(salt),
                "maker": message["maker"],
                "signer": message["signer"],
                "taker": message["taker"],
                "tokenId": str(token_id),
                "makerAmount": str(maker_amount),
                "takerAmount": str(taker_amount),
                "expiration": str(exp_time),
                "nonce": "0",
                "feeRateBps": str(fee_rate_bps),
                "side": order_side,
                "signatureType": 0,
                "hash": order_hash,
                "signature": signature
            }
        }
        if is_post_only:
            order_payload["isPostOnly"] = True
        
        return await self.create_order(order_payload, return_full_response=return_full_response)

    async def smart_minimum_order(
        self,
        market: dict[str, Any],
        outcome_name: str,
        price: float | int | str | Decimal,
        side: str = "BUY",
        *,
        min_order_value: float | int | str | Decimal = PREDICT_MIN_ORDER_VALUE,
        is_post_only: bool = True,
        return_full_response: bool = False,
        auto_expire_seconds: int = 130,
    ) -> dict | None:
        """Place the smallest whole-share limit order that passes Predict's minimum value.
        
        The order is configured to automatically expire if not filled within 
        `auto_expire_seconds` (default 130 seconds; minimum allowed by API is 120s).
        """
        size = self.minimum_order_size(price, min_order_value)
        notional = Decimal(str(price)) * size
        expiration_ts = int(time.time()) + auto_expire_seconds
        logger.info(
            "Predict.fun smart minimum order: side=%s price=%s size=%s notional=%s min=%s post_only=%s exp=%ds",
            side.upper(),
            price,
            size,
            notional,
            min_order_value,
            is_post_only,
            auto_expire_seconds,
        )
        return await self.place_limit_order(
            market=market,
            outcome_name=outcome_name,
            side=side,
            price=price,
            size=size,
            is_post_only=is_post_only,
            return_full_response=return_full_response,
            expiration=expiration_ts,
        )

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
            async with self._http_client() as client:
                resp = await client.post(url, headers=headers, json={"data": {"ids": ids}}, timeout=15)
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error("Predict.fun cancel orders failed: %s %s", e.response.status_code, e.response.text)
            raise e
        except Exception as e:
            logger.error("Predict.fun cancel orders error: %s", e)
            raise e

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
