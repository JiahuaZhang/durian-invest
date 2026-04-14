from datetime import datetime, timezone


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def compute_candle_age(market: dict) -> float:
    """
    Returns seconds since this market opened.
    Tries open_time first, falls back to created_time.
    Returns 9999 if unparseable (causes strategies to skip the market).
    """
    raw = market.get("open_time") or market.get("created_time", "")
    if not raw:
        return 9999.0
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return max((_now_utc() - dt).total_seconds(), 0.0)
    except Exception:
        return 9999.0


def compute_minutes_remaining(market: dict) -> float:
    """Returns minutes until market closes (close_time field). 0 if expired/unparseable."""
    raw = market.get("close_time", "")
    if not raw:
        return 0.0
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return max((_now_utc() - dt).total_seconds() * -1 / 60.0, 0.0)
    except Exception:
        return 0.0
