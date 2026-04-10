"""
Weather Arbitrage Strategy
--------------------------
Polls Kalshi weather markets every 5 minutes.
Compares METAR + NWS forecast against market price to find edges.
Logs every signal and bet lifecycle to Supabase.

Environment variables required:
  KALSHI_API_KEY_ID        — from kalshi.com → Settings → API
  KALSHI_PRIVATE_KEY_PATH  — path to your RSA private key .pem file
  KALSHI_DRY_RUN           — 'true' (default) or 'false'
  KALSHI_MAX_BET_USD       — max USD per bet (default: 5.0)
  KALSHI_EDGE_THRESHOLD    — minimum edge to enter (default: 0.15)
  SUPABASE_URL             — from .env
  SUPABASE_SERVICE_KEY     — from .env
"""
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

from ..base_strategy import TradingStrategy
from ..registry import StrategyRegistry
from .kalshi_client import KalshiClient
from .models import WeatherBet, WeatherSignal
from .supabase_logger import SupabaseLogger
from .weather_client import WeatherClient

logger = logging.getLogger(__name__)

load_dotenv()

# City → (ICAO station, lat, lon)
# Keep aligned with the markets Kalshi actually lists.
CITY_MAP = {
    "New York":     ("KLGA",  40.7769, -73.8740),
    "Chicago":      ("KORD",  41.9742, -87.9073),
    "Los Angeles":  ("KLAX",  33.9425, -118.4081),
    "Miami":        ("KMIA",  25.7959, -80.2870),
    "Dallas":       ("KDFW",  32.8998, -97.0403),
    "Denver":       ("KDEN",  39.8561, -104.6737),
    "Atlanta":      ("KATL",  33.6367, -84.4281),
    "Seattle":      ("KSEA",  47.4502, -122.3088),
    "Boston":       ("KBOS",  42.3631, -71.0060),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_market(market: dict) -> Optional[tuple]:
    """
    Extract (city, metric, threshold_f, target_date) from a Kalshi market dict.
    Returns None if we cannot parse it.

    Kalshi market titles look like:
      "Chicago high temperature above 54°F on March 11, 2026"
      "New York high temperature on April 6, 2026"
    This is a best-effort parser — extend as you encounter actual title formats.
    """
    title = market.get("title", "")
    target_date = None

    # Attempt to find a known city
    city = next((c for c in CITY_MAP if c.lower() in title.lower()), None)
    if not city:
        return None

    # Determine metric
    if "high" in title.lower():
        metric = "high_temp"
    elif "low" in title.lower():
        metric = "low_temp"
    else:
        return None

    # Extract threshold (e.g. "54°F" or "90°F")
    import re
    m = re.search(r"(\d+(?:\.\d+)?)\s*°?F", title)
    if not m:
        return None
    threshold_f = float(m.group(1))

    # Extract date from close_time (when market resolves)
    close_time = market.get("close_time", "")
    if close_time:
        try:
            target_date = close_time[:10]  # YYYY-MM-DD
        except Exception:
            return None

    if not target_date:
        return None

    return city, metric, threshold_f, target_date


def _estimate_probability(
    _metric: str,
    threshold_f: float,
    nws_forecast_f: Optional[float],
    _metar_temp_f: Optional[float],
) -> float:
    """
    Simple probability estimate: use NWS forecast as the primary signal.
    Returns P(yes) — probability that the threshold is met.

    This is intentionally conservative. Improve by:
    - Using GFS ensemble spread for confidence intervals
    - Weighing METAR trend (current temp vs. historical for this time of day)
    """
    if nws_forecast_f is None:
        return 0.5  # no information → neutral

    margin = nws_forecast_f - threshold_f
    # Sigmoid-like mapping: margin of ±10°F → probability ~0.9 or ~0.1
    import math
    p = 1 / (1 + math.exp(-margin / 5.0))
    return round(p, 4)


def _kelly_contracts(p: float, market_yes_price: float, side: str, bankroll: float, max_bet: float) -> int:
    """
    Return number of $0.01 contracts to buy using half-Kelly, capped at max_bet.
    Kalshi contracts are binary: win $1 or lose your stake.
    """
    if side == "yes":
        b = (1.0 - market_yes_price) / market_yes_price  # net odds on YES
        kelly = (p * b - (1 - p)) / b
    else:
        q = 1 - p
        no_price = 1 - market_yes_price
        b = (1.0 - no_price) / no_price
        kelly = (q * b - (1 - q)) / b

    kelly = max(kelly, 0)
    half_kelly = kelly * 0.5
    bet_usd = min(bankroll * half_kelly, max_bet, bankroll * 0.02)
    # Kalshi contracts: each costs price_per_contract dollars
    price = market_yes_price if side == "yes" else (1 - market_yes_price)
    contracts = int(bet_usd / price) if price > 0 else 0
    return max(contracts, 0)


class WeatherArbStrategy(TradingStrategy):
    def get_name(self) -> str:
        return "weather-arb"

    def get_type(self) -> str:
        return "scheduled"

    async def initialize(self):
        kalshi_key_id = os.getenv("KALSHI_API_KEY_ID")
        kalshi_private_key = os.getenv("KALSHI_PRIVATE_KEY")
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

        if not all([kalshi_key_id, kalshi_private_key, supabase_url, supabase_key]):
            raise ValueError(
                "Missing required env vars: KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY, "
                "SUPABASE_URL, SUPABASE_SERVICE_KEY"
            )

        dry_run = os.getenv("KALSHI_DRY_RUN", "true").lower() != "false"
        self._max_bet_usd = float(os.getenv("KALSHI_MAX_BET_USD", "5.0"))
        self._edge_threshold = float(os.getenv("KALSHI_EDGE_THRESHOLD", "0.15"))

        self._kalshi = KalshiClient(kalshi_key_id, kalshi_private_key, dry_run=dry_run)
        self._weather = WeatherClient()
        self._db = SupabaseLogger(supabase_url, supabase_key)
        self._scheduler = AsyncIOScheduler()
        self._stats = {"signals": 0, "bets": 0, "skipped": 0}
        self.is_running = False

        logger.info(
            f"WeatherArb initialized | dry_run={dry_run} | "
            f"edge_threshold={self._edge_threshold} | max_bet=${self._max_bet_usd}"
        )

    async def start(self):
        self._scheduler.add_job(self._scan, "interval", minutes=5, id="weather_scan")
        self._scheduler.start()
        self.is_running = True
        logger.info("WeatherArb strategy started (scanning every 5 minutes)")

    async def stop(self):
        self._scheduler.shutdown(wait=False)
        await self._kalshi.close()
        await self._weather.close()
        self.is_running = False
        logger.info(f"WeatherArb stopped. Stats: {self._stats}")

    def get_stats(self):
        return self._stats.copy()

    async def _scan(self):
        """Main loop: fetch markets, evaluate each, place bets if edge found."""
        logger.info("Scanning Kalshi weather markets...")
        markets = await self._kalshi.get_weather_markets()
        balance = await self._kalshi.get_balance()
        logger.info(f"Found {len(markets)} open weather markets | Balance: ${balance:.2f}")

        for market in markets:
            try:
                await self._evaluate_market(market, balance)
            except Exception as e:
                logger.error(f"Error evaluating {market.get('ticker')}: {e}")

        await self._check_resolutions()

    async def _evaluate_market(self, market: dict, bankroll: float):
        parsed = _parse_market(market)
        if not parsed:
            return

        city, metric, threshold_f, target_date = parsed
        icao, lat, lon = CITY_MAP[city]
        ticker = market["ticker"]
        market_yes_price = market.get("yes_bid", 0) / 100.0  # Kalshi prices in cents

        if market_yes_price <= 0 or market_yes_price >= 1:
            return

        metar_f = await self._weather.get_metar_temp_f(icao)
        nws_f = await self._weather.get_nws_forecast_high_f(lat, lon, target_date)

        our_p = _estimate_probability(metric, threshold_f, nws_f, metar_f)
        edge = our_p - market_yes_price

        # Determine action
        if edge >= self._edge_threshold:
            action = "BUY_YES"
        elif edge <= -self._edge_threshold:
            action = "BUY_NO"
        else:
            action = "SKIP"

        signal = WeatherSignal(
            detected_at=_now_iso(),
            market_ticker=ticker,
            city=city,
            icao=icao,
            metric=metric,
            threshold=threshold_f,
            target_date=target_date,
            metar_temp_f=metar_f,
            nws_forecast_value=nws_f,
            our_probability=our_p,
            market_yes_price=market_yes_price,
            edge=edge,
            action=action,
        )
        await self._db.log_signal(signal)
        self._stats["signals"] += 1

        if action == "SKIP":
            self._stats["skipped"] += 1
            return

        side = "yes" if action == "BUY_YES" else "no"
        contracts = _kelly_contracts(our_p, market_yes_price, side, bankroll, self._max_bet_usd)
        if contracts <= 0:
            return

        price = market_yes_price if side == "yes" else (1 - market_yes_price)
        price_cents = int(price * 100)
        order = await self._kalshi.place_order(ticker, side, contracts, price_cents)
        if not order:
            return

        bet = WeatherBet(
            signal_id=signal.id,
            placed_at=_now_iso(),
            market_ticker=ticker,
            side=side,
            contracts=contracts,
            price_per_contract=price,
            total_cost=round(price * contracts, 2),
            kalshi_order_id=order.get("order_id", ""),
            status=order.get("status", "open"),
        )
        await self._db.log_bet(bet)
        self._stats["bets"] += 1

    async def _check_resolutions(self):
        """
        Check open positions for settled markets and log resolutions.
        Kalshi marks settled positions with a result field.
        """
        positions = await self._kalshi.get_open_positions()
        for pos in positions:
            if pos.get("resting_orders_count", 1) > 0:
                continue  # still open
            # Position has settled — log resolution
            # (In practice, you'd cross-reference with weather_bets table;
            #  this is a simplified version)
            ticker = pos.get("market_ticker", "")
            result = pos.get("realized_pnl", 0) / 100.0  # cents → USD
            logger.info(f"Settled position {ticker}: P&L=${result:.2f}")


StrategyRegistry.register('weather-arb', WeatherArbStrategy)
