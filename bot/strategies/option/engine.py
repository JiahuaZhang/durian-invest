"""
Option Engine
=============
Evaluates whether conditions are favorable to sell an OTM put on a given
symbol, then sends a Telegram notification with the full assessment.

Filters applied (in order):
  1. Trend filter     — price above 50-day MA (uptrend) or disabled
  2. IV Rank          — implied volatility rank in [ivr_min, ivr_max]
  3. IV-RV spread     — implied volatility exceeds realized volatility by >= iv_rv_min_spread pp

Data sources:
  - yfinance (^VIX for SPY, ^VXN for QQQ): implied volatility
  - yfinance daily OHLCV: realized volatility (20-day HV), MA(20), MA(50)
  - yfinance ^VIX 252-day history: IV Rank computation

The estimated premium uses a Black-Scholes approximation. The actual market
bid/ask will differ — always check your broker before trading.
"""

import asyncio
import logging
from datetime import datetime, timedelta, date as date_type
from typing import Optional, Dict

import numpy as np
import pytz
import yfinance as yf
from scipy.stats import norm

from .config import OptionConfig
from .models import OptionSignal
from strategies.telegram_notifier import TelegramNotifier

logger = logging.getLogger(__name__)
ET = pytz.timezone('America/New_York')

# Implied volatility proxy ticker per symbol
# VIX tracks SPY; VXN tracks QQQ; everything else uses VIX scaled by a multiplier
_IV_TICKER: Dict[str, str] = {
    'SPY': '^VIX',
    'QQQ': '^VXN',
}
_IV_MULT: Dict[str, float] = {
    'SPY': 1.0, 'QQQ': 1.0,   # using dedicated index for these
    'AAPL': 1.1, 'CSCO': 1.1, 'AMZN': 1.3,
    'META': 1.4, 'TSLA': 2.0, 'NVDA': 1.8,
}


def _bs_put(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Black-Scholes put price. Used for premium estimate only."""
    if T <= 0 or sigma <= 0:
        return max(0.0, K - S)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    return float(K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1))


class OptionEngine:
    def __init__(self, config: OptionConfig, notifier: TelegramNotifier):
        self.config = config
        self.notifier = notifier
        self._checked_this_week: Dict[str, str] = {}   # symbol -> ISO week str

    def reset(self):
        """Reset weekly state. Called pre-market Monday."""
        self._checked_this_week.clear()
        logger.info("Option engine reset. Symbols: %s", self.config.symbols)

    # ─── Market data helpers ──────────────────────────────────────────────────

    async def _get_daily_history(self, symbol: str, days: int = 300):
        """Fetch ~300 days of daily OHLCV for MA and realized volatility computation."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: yf.Ticker(symbol).history(period=f'{days}d', interval='1d'),
        )

    async def _get_iv_history(self, symbol: str, days: int = 300):
        """
        Fetch implied volatility index history.
        SPY -> ^VIX, QQQ -> ^VXN, others -> ^VIX (scaled by _IV_MULT).
        Returns a pandas Series of daily closing values (as annualized %, e.g. 18.5).
        """
        iv_ticker = _IV_TICKER.get(symbol, '^VIX')
        loop = asyncio.get_event_loop()
        hist = await loop.run_in_executor(
            None,
            lambda: yf.Ticker(iv_ticker).history(period=f'{days}d', interval='1d'),
        )
        if hist.empty:
            return None
        iv_series = hist['Close']
        mult = _IV_MULT.get(symbol, 1.2)
        if symbol not in _IV_TICKER:
            iv_series = iv_series * mult
        return iv_series

    def _compute_realized_volatility(self, hist) -> float:
        """20-day annualized historical volatility from daily log returns."""
        if hist is None or len(hist) < 22:
            return 0.0
        log_returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna()
        if len(log_returns) < 20:
            return 0.0
        hv_20 = float(log_returns.tail(20).std() * np.sqrt(252))
        return hv_20

    def _compute_iv_rank(self, iv_series, current_iv: float) -> float:
        """
        IV Rank = (current_iv - 52w_low) / (52w_high - 52w_low) * 100
        Returns 0–100. Higher = implied volatility is rich relative to recent history.
        """
        if iv_series is None or len(iv_series) < 50:
            return 50.0   # unknown — use neutral value
        last_252 = iv_series.tail(252)
        low_52w  = float(last_252.min())
        high_52w = float(last_252.max())
        if high_52w <= low_52w:
            return 50.0
        rank = (current_iv - low_52w) / (high_52w - low_52w) * 100
        return round(min(100.0, max(0.0, rank)), 1)

    def _compute_trend(self, hist) -> str:
        """
        Simple trend: price above 50-day MA = uptrend, below = downtrend.
        Returns 'uptrend', 'downtrend', or 'unknown'.
        """
        if hist is None or len(hist) < 52:
            return 'unknown'
        ma50 = float(hist['Close'].tail(50).mean())
        current = float(hist['Close'].iloc[-1])
        if current > ma50:
            return 'uptrend'
        return 'downtrend'

    @staticmethod
    def _next_friday(ref_date: date_type) -> date_type:
        days_ahead = (4 - ref_date.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7
        return ref_date + timedelta(days=days_ahead)

    # ─── Signal check ─────────────────────────────────────────────────────────

    async def check_signal(self, symbol: str, day_name: str) -> OptionSignal:
        """
        Evaluate whether now is a good time to sell an OTM put on symbol.
        Always returns a signal (with all_passed=True or False).
        Sends a Telegram notification only when all_passed=True.
        """
        now_et  = datetime.now(ET)
        today   = now_et.date()
        week_id = str(today.isocalendar()[1])

        signal = OptionSignal(
            symbol=symbol,
            date=str(today),
            check_time=now_et.isoformat(),
            day_of_week=day_name,
            option_type='put',
        )

        if self._checked_this_week.get(symbol) == week_id:
            logger.info("%s: already checked this week", symbol)
            signal.rationale = "Already checked this week."
            return signal

        # Fetch all data concurrently
        hist_task   = asyncio.create_task(self._get_daily_history(symbol))
        iv_task     = asyncio.create_task(self._get_iv_history(symbol))
        hist, iv_series = await asyncio.gather(hist_task, iv_task)

        if hist is None or hist.empty:
            logger.warning("%s: no daily history available", symbol)
            signal.rationale = "Could not fetch market data."
            return signal

        # Current price and moving averages
        signal.current_price = float(hist['Close'].iloc[-1])
        signal.ma20 = float(hist['Close'].tail(20).mean()) if len(hist) >= 20 else 0.0
        signal.ma50 = float(hist['Close'].tail(50).mean()) if len(hist) >= 50 else 0.0
        signal.trend = self._compute_trend(hist)

        # Realized volatility (20-day historical volatility, annualized)
        signal.realized_volatility = self._compute_realized_volatility(hist)

        # Current implied volatility (today's close of VIX/VXN as annualized %)
        if iv_series is not None and not iv_series.empty:
            signal.implied_volatility = float(iv_series.iloc[-1])
        else:
            signal.implied_volatility = 20.0   # fallback

        # IV Rank (0–100)
        signal.iv_rank = self._compute_iv_rank(iv_series, signal.implied_volatility)

        # IV-RV spread (percentage points, annualized)
        signal.iv_rv_spread = round(signal.implied_volatility - signal.realized_volatility * 100, 2)

        logger.info(
            "%s: price=%.2f trend=%s IV=%.1f%% RV=%.1f%% IV-RV=%.1fpp IVR=%.1f",
            symbol, signal.current_price, signal.trend,
            signal.implied_volatility, signal.realized_volatility * 100,
            signal.iv_rv_spread, signal.iv_rank,
        )

        # ── Apply filters ──────────────────────────────────────────────────────

        signal.trend_ok = (
            not self.config.trend_filter or signal.trend == 'uptrend'
        )
        signal.ivr_ok = (self.config.ivr_min <= signal.iv_rank <= self.config.ivr_max)
        signal.iv_rv_ok = (signal.iv_rv_spread >= self.config.iv_rv_min_spread)
        signal.all_passed = signal.trend_ok and signal.ivr_ok and signal.iv_rv_ok

        self._checked_this_week[symbol] = week_id

        # ── Build recommendation if all filters passed ─────────────────────────

        if signal.all_passed:
            expiry = self._next_friday(today)
            dte    = (expiry - today).days
            strike = round(signal.current_price * (1 - self.config.wing_pct), 2)

            # Black-Scholes premium estimate (IV is in %, convert to decimal)
            iv_decimal = signal.implied_volatility / 100
            T = dte / 365.0
            r = 0.045
            prem = _bs_put(signal.current_price, strike, T, r, iv_decimal)

            signal.suggested_strike      = strike
            signal.expiry_date           = str(expiry)
            signal.dte                   = dte
            signal.estimated_premium_pct = round(prem / signal.current_price * 100, 3)

            signal.rationale = (
                f"All filters passed. "
                f"IV Rank {signal.iv_rank:.0f} in [{self.config.ivr_min:.0f}–{self.config.ivr_max:.0f}]. "
                f"IV-RV spread +{signal.iv_rv_spread:.1f}pp. "
                f"Trend: {signal.trend}."
            )
            logger.info(
                "SIGNAL %s: sell PUT strike=%.2f exp=%s DTE=%d est.premium=%.3f%%",
                symbol, strike, expiry, dte, signal.estimated_premium_pct,
            )
            await self._notify_pass(signal)
        else:
            reasons = []
            if not signal.trend_ok:
                reasons.append(
                    f"trend is {signal.trend} (price ${signal.current_price:.2f} "
                    f"below 50-day MA ${signal.ma50:.2f})"
                )
            if not signal.ivr_ok:
                reasons.append(
                    f"IV Rank {signal.iv_rank:.0f} outside range "
                    f"[{self.config.ivr_min:.0f}–{self.config.ivr_max:.0f}]"
                )
            if not signal.iv_rv_ok:
                reasons.append(
                    f"IV-RV spread {signal.iv_rv_spread:.1f}pp below minimum "
                    f"{self.config.iv_rv_min_spread:.1f}pp"
                )
            signal.rationale = "No signal: " + "; ".join(reasons) + "."
            logger.info("%s: no signal — %s", symbol, signal.rationale)

        return signal

    # ─── Telegram notifications ───────────────────────────────────────────────

    async def _notify_pass(self, signal: OptionSignal):
        """Send Telegram alert when all filters pass — sell put recommendation."""
        trend_icon = "✅" if signal.trend_ok else "❌"
        ivr_icon   = "✅" if signal.ivr_ok   else "❌"
        ivrv_icon  = "✅" if signal.iv_rv_ok  else "❌"

        msg = (
            f"<b>OPTION SIGNAL: {signal.symbol}</b>\n\n"
            f"Day: {signal.day_of_week} | {signal.check_time[11:16]} ET\n\n"
            f"Conditions are favorable to sell a PUT.\n\n"
            f"<b>Recommendation: Sell PUT</b>\n"
            f"  Strike:           ${signal.suggested_strike:.2f}"
            f" ({self.config.wing_pct*100:.0f}% below ${signal.current_price:.2f})\n"
            f"  Expiry:           {signal.expiry_date} ({signal.dte} DTE)\n"
            f"  Estimated premium: {signal.estimated_premium_pct:.3f}% of underlying\n\n"
            f"Volatility conditions:\n"
            f"  {ivr_icon} IV Rank: {signal.iv_rank:.0f}"
            f" (range {self.config.ivr_min:.0f}–{self.config.ivr_max:.0f})\n"
            f"  {ivrv_icon} IV-RV spread: +{signal.iv_rv_spread:.1f}pp"
            f" (minimum {self.config.iv_rv_min_spread:.1f}pp)\n"
            f"  Implied volatility: {signal.implied_volatility:.1f}%\n"
            f"  Realized volatility (20d): {signal.realized_volatility*100:.1f}%\n\n"
            f"Trend:\n"
            f"  {trend_icon} {signal.trend.capitalize()}"
            f" (price ${signal.current_price:.2f} vs 50-day MA ${signal.ma50:.2f})\n\n"
            f"<i>Notification only. Verify the actual bid/ask on your broker before trading.</i>"
        )
        await self.notifier.send(msg)
