"""
Polymarket crypto up/down event timestamp and slug generation.

Polymarket event URLs follow this pattern:
    https://polymarket.com/event/{crypto}-updown-{interval}m-{timestamp}

Where {timestamp} is Unix epoch seconds (UTC), floored to the interval
boundary (start of the window). For example:
    btc-updown-5m-1777899900  →  2026-05-04 13:05:00 UTC (9:05 ET)

Available cryptos (as of May 2026):
    btc, eth, sol, xrp, doge, hype, bnb
"""

import time
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

CRYPTO = Literal["btc", "eth", "sol", "xrp", "doge", "hype", "bnb"]
SUPPORTED_CRYPTOS: list[str] = ["btc", "eth", "sol", "xrp", "doge", "hype", "bnb"]


# ── Core timestamp functions ───────────────────────────────────────

def get_timestamp(crypto: CRYPTO = "btc", interval_minutes: int = 5, offset: int = 0) -> int:
    """
    Get the Polymarket event timestamp for a crypto up/down window.

    The timestamp is Unix seconds (UTC), floored to the interval start.

    Args:
        crypto: ticker — btc, eth, sol, xrp, doge, hype, bnb
        interval_minutes: window size (5, 15, 60, etc.)
        offset: 0 = current window, -1 = previous (just closed),
                +1 = next window, etc.

    Returns:
        Unix timestamp (int) for the start of the window.

    Examples:
        get_timestamp("btc")              → current BTC 5-min window
        get_timestamp("eth", 15)          → current ETH 15-min window
        get_timestamp("sol", 5, offset=1) → next SOL 5-min window
    """
    now = int(time.time())
    interval_seconds = interval_minutes * 60
    window_start = (now // interval_seconds) * interval_seconds
    return window_start + offset * interval_seconds


def get_event_slug(crypto: CRYPTO = "btc", interval_minutes: int = 5, offset: int = 0) -> str:
    """
    Get the full Polymarket event slug.

    Returns:
        e.g. "btc-updown-5m-1777899900"
             "eth-updown-15m-1777901700"
    """
    ts = get_timestamp(crypto, interval_minutes, offset)
    return f"{crypto}-updown-{interval_minutes}m-{ts}"


def get_market_slug(crypto: CRYPTO = "btc", interval_minutes: int = 5, offset: int = 0) -> str:
    """
    Get the full Polymarket market slug.

    Returns:
        e.g. "btc-updown-5m-1777899900"
             "eth-updown-15m-1777901700"
    """
    ts = get_timestamp(crypto, interval_minutes, offset)
    return f"{crypto}-updown-{interval_minutes}m-{ts}"


def get_event_url(crypto: CRYPTO = "btc", interval_minutes: int = 5, offset: int = 0) -> str:
    """
    Get the full Polymarket event URL.

    Returns:
        e.g. "https://polymarket.com/event/btc-updown-5m-1777899900"
    """
    return f"https://polymarket.com/event/{get_event_slug(crypto, interval_minutes, offset)}"


def get_window_range(crypto: CRYPTO = "btc", interval_minutes: int = 5, offset: int = 0) -> tuple[int, int]:
    """
    Get (start, end) Unix timestamps for the window.

    Returns:
        (start_ts, end_ts) — both in Unix seconds UTC.
    """
    start = get_timestamp(crypto, interval_minutes, offset)
    return start, start + interval_minutes * 60


# ── Display helpers ────────────────────────────────────────────────

def format_timestamp_et(ts: int) -> str:
    """Format a Unix timestamp as ET time string."""
    dt = datetime.fromtimestamp(ts, tz=_ET)
    hour = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    return f"{hour}:{dt.minute:02d}{ampm} ET"


def get_window_label(crypto: CRYPTO = "btc", interval_minutes: int = 5, offset: int = 0) -> str:
    """
    Human-readable window label.

    Returns:
        e.g. "BTC 9:25AM ET-9:30AM ET"
    """
    start, end = get_window_range(crypto, interval_minutes, offset)
    return f"{crypto.upper()} {format_timestamp_et(start)}-{format_timestamp_et(end)}"


def countdown(crypto: CRYPTO = "btc", interval_minutes: int = 5) -> str:
    """
    Return ``[MM:SS]`` countdown until the current window closes.
    """
    _, end = get_window_range(crypto, interval_minutes)
    secs_left = max(0, end - int(time.time()))
    m, s = divmod(secs_left, 60)
    return f"[{m}:{s:02d}]"


def seconds_remaining(crypto: CRYPTO = "btc", interval_minutes: int = 5) -> int:
    """Seconds until the current window closes."""
    _, end = get_window_range(crypto, interval_minutes)
    return max(0, end - int(time.time()))


def seconds_elapsed(crypto: CRYPTO = "btc", interval_minutes: int = 5) -> int:
    """Seconds since the current window opened."""
    start, _ = get_window_range(crypto, interval_minutes)
    return int(time.time()) - start


# ── Legacy aliases (used by runner.py) ─────────────────────────────

def countdown_5m(interval_minutes: int = 5) -> str:
    return countdown("btc", interval_minutes)


def seconds_to_next_5m(interval_minutes: int = 5) -> int:
    return seconds_remaining("btc", interval_minutes)
