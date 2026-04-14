"""
Kalshi Crypto Client
--------------------
Extends KalshiClient with:
  - Multi-asset market fetching via series ticker
  - Price feed with 3-tier fallback per asset
  - cancel_order for Market Maker cleanup

Price feed priority per asset:
  1. Coinbase Exchange REST  — BRTI constituent, USD-denominated (all except BNB)
  2. Kraken public REST      — BRTI constituent, no auth, no geo-restrictions
  3. Binance.US public REST  — fallback / primary for BNB (not a BRTI exchange)

Kalshi settles 15-min crypto markets on the CF Benchmarks Bitcoin Real-Time Index
(BRTI), whose constituent exchanges are Bitstamp, Coinbase, Gemini, itBit, and
Kraken.  Binance is NOT a BRTI constituent, so despite its large volume it
introduces basis risk.  Coinbase is therefore the preferred feed; Kraken is the
first fallback; Binance.US covers BNB (not listed on Coinbase) and acts as a
final safety net.
"""
import logging
from typing import Optional

import httpx

from ..polymarket_weather.kalshi_client import KalshiClient
from .models import PriceWindow

logger = logging.getLogger(__name__)

# ── Feed lookup tables ────────────────────────────────────────────────────────

# Coinbase Exchange product IDs (BNB not listed on Coinbase)
COINBASE_PRODUCTS: dict[str, str] = {
    "btc":  "BTC-USD",
    "eth":  "ETH-USD",
    "sol":  "SOL-USD",
    "xrp":  "XRP-USD",
    "doge": "DOGE-USD",
    "avax": "AVAX-USD",
    "ltc":  "LTC-USD",
    # bnb intentionally absent
}

# Kraken pair name per asset_id
# Legacy names: DOGE=XDG, BTC=XBT, ETH/XRP/LTC have X prefix
KRAKEN_PAIRS: dict[str, str] = {
    "btc":  "XBTUSD",
    "eth":  "XETHZUSD",
    "sol":  "SOLUSD",
    "xrp":  "XXRPZUSD",
    "doge": "XDGUSD",
    "bnb":  "BNBUSD",
    "avax": "AVAXUSD",
    "ltc":  "XLTCZUSD",
}

# Binance.US symbols (fallback / covers BNB)
BINANCEUS_SYMBOLS: dict[str, str] = {
    "btc":  "BTCUSDT",
    "eth":  "ETHUSDT",
    "sol":  "SOLUSDT",
    "xrp":  "XRPUSDT",
    "doge": "DOGEUSDT",
    "bnb":  "BNBUSDT",
    "avax": "AVAXUSDT",
    "ltc":  "LTCUSDT",
}


class KalshiCryptoClient(KalshiClient):
    """
    Extends KalshiClient for multi-asset crypto markets.
    Parent class handles RSA auth, place_order, get_balance, get_open_positions.
    """

    def __init__(self, api_key_id: str, private_key_pem: str, dry_run: bool = True):
        super().__init__(api_key_id, private_key_pem, dry_run)
        self._http = httpx.AsyncClient(timeout=10.0)

    async def close(self):
        await super().close()
        await self._http.aclose()

    # ── Kalshi market fetching ───────────────────────────────────────────────

    async def get_markets(self, series_ticker: str, limit: int = 50) -> list[dict]:
        """Fetch all open markets for a series (e.g. 'KXBTC')."""
        path = "/markets"
        headers = self._sign("GET", path)
        try:
            resp = await self._client.get(
                path, headers=headers,
                params={"status": "open", "series_ticker": series_ticker, "limit": limit},
            )
            resp.raise_for_status()
            return resp.json().get("markets", [])
        except Exception as e:
            logger.error(f"Failed to fetch markets for {series_ticker}: {e}")
            return []

    async def cancel_order(self, order_id: str) -> bool:
        """Cancel a resting limit order. Used by Market Maker's 30s cleanup."""
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

    # ── Price feed ───────────────────────────────────────────────────────────

    async def get_price_window(self, asset_id: str, lookback: int = 60) -> Optional[PriceWindow]:
        """
        Fetch 1-min OHLCV for asset_id.

        Feed priority (settlement-alignment first):
          1. Coinbase — BRTI constituent, USD-native (skipped for BNB)
          2. Kraken   — BRTI constituent, public API
          3. Binance.US — fallback, covers BNB
        """
        # 1. Coinbase (not available for BNB)
        cb_product = COINBASE_PRODUCTS.get(asset_id)
        if cb_product:
            window = await self._fetch_coinbase(cb_product, lookback)
            if window:
                return window
            logger.warning(f"Coinbase failed for {asset_id} — trying Kraken")

        # 2. Kraken
        kraken_pair = KRAKEN_PAIRS.get(asset_id)
        if kraken_pair:
            window = await self._fetch_kraken(kraken_pair, lookback)
            if window:
                return window
            logger.warning(f"Kraken failed for {asset_id} — trying Binance.US")

        # 3. Binance.US
        return await self._fetch_binanceus(asset_id, lookback)

    async def _fetch_coinbase(self, product_id: str, lookback: int) -> Optional[PriceWindow]:
        """
        Coinbase Exchange candles endpoint.
        Returns [timestamp, price_low, price_high, price_open, price_close, volume]
        Newest first — we reverse so oldest is index 0.
        """
        try:
            resp = await self._http.get(
                f"https://api.exchange.coinbase.com/products/{product_id}/candles",
                params={"granularity": 60},
            )
            resp.raise_for_status()
            candles = resp.json()
            if not candles:
                return None
            # Newest first → reverse to oldest-first, then take last `lookback`
            candles = list(reversed(candles))[-lookback:]
            closes  = [float(c[4]) for c in candles]
            volumes = [float(c[5]) for c in candles]
            return PriceWindow(closes=closes, volumes=volumes)
        except Exception as e:
            logger.warning(f"Coinbase fetch failed for {product_id}: {e}")
            return None

    async def _fetch_kraken(self, pair: str, lookback: int) -> Optional[PriceWindow]:
        """
        Kraken OHLC: [time, open, high, low, close, vwap, volume, count]
        Oldest first. API returns up to 720 candles for 1-min interval.
        """
        try:
            resp = await self._http.get(
                "https://api.kraken.com/0/public/OHLC",
                params={"pair": pair, "interval": 1},
            )
            resp.raise_for_status()
            body = resp.json()
            if body.get("error"):
                logger.warning(f"Kraken error for {pair}: {body['error']}")
                return None
            result = body.get("result", {})
            candles = next((v for k, v in result.items() if k != "last"), None)
            if not candles:
                return None
            candles = candles[-lookback:]
            closes  = [float(c[4]) for c in candles]
            volumes = [float(c[6]) for c in candles]
            return PriceWindow(closes=closes, volumes=volumes)
        except Exception as e:
            logger.warning(f"Kraken fetch failed for {pair}: {e}")
            return None

    async def _fetch_binanceus(self, asset_id: str, lookback: int) -> Optional[PriceWindow]:
        """
        Binance.US klines: [openTime, open, high, low, close, volume, ...]
        Oldest first.
        """
        symbol = BINANCEUS_SYMBOLS.get(asset_id)
        if not symbol:
            return None
        try:
            resp = await self._http.get(
                "https://api.binance.us/api/v3/klines",
                params={"symbol": symbol, "interval": "1m", "limit": lookback},
            )
            resp.raise_for_status()
            candles = resp.json()
            if not candles:
                return None
            closes  = [float(c[4]) for c in candles]
            volumes = [float(c[5]) for c in candles]
            return PriceWindow(closes=closes, volumes=volumes)
        except Exception as e:
            logger.warning(f"Binance.US fetch failed for {asset_id}: {e}")
            return None
