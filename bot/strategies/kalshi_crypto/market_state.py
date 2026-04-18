from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

# Kalshi encodes all 15-min market close times in Eastern time.
# e.g. kxbtc15m-26apr190000 closes at April 19 00:00 ET (= 04:00 UTC).
_ET = ZoneInfo("America/New_York")


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


def compute_seconds_remaining(market: dict) -> float:
    """Returns seconds until market closes (close_time field). 0 if expired/unparseable."""
    raw = market.get("close_time", "")
    if not raw:
        return 0.0
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return max((_now_utc() - dt).total_seconds() * -1, 0.0)
    except Exception:
        return 0.0


def current_market_ticker(series: str, now: datetime) -> tuple[str, datetime]:
    """
    Generate the ticker and close_time for the currently-open 15-min window.

    Kalshi encodes the close boundary in Eastern time regardless of UTC date,
    so we convert now → ET before computing the boundary and formatting the ticker.
    The returned close_time is UTC for downstream arithmetic.

      KXBTC15M-26APR172300-00   (April 17 23:00 ET, even if that's April 18 UTC)
               ^^^^^^^^^^^ ^^
               YYMONDDHHM  MM (minutes repeated, ET)
    """
    now_et = now.astimezone(_ET)

    next_q = ((now_et.minute // 15) + 1) * 15
    if next_q >= 60:
        close_et = (now_et + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    else:
        close_et = now_et.replace(minute=next_q, second=0, microsecond=0)

    ticker = (
        f"{series}"
        f"-{close_et.strftime('%y')}{close_et.strftime('%b').upper()}{close_et.strftime('%d')}"
        f"{close_et.strftime('%H%M')}"
        f"-{close_et.strftime('%M')}"
    )
    return ticker, close_et.astimezone(timezone.utc)
