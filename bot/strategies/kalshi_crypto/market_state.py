from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# Kalshi encodes all 15-min market close times in Eastern time.
# e.g. kxbtc15m-26apr190000 closes at April 19 00:00 ET (= 04:00 UTC).
_ET = ZoneInfo("America/New_York")

def get_current_15m_market_ticker(series: str) -> str:
    later = datetime.now().astimezone(_ET).replace(second=0, microsecond=0) + timedelta(minutes=15)
    quarter = later.minute // 15
    close_et = later.replace(minute=quarter * 15)

    return (
        f"{series}"
        f"-{close_et.strftime('%y')}{close_et.strftime('%b').upper()}{close_et.strftime('%d')}"
        f"{close_et.strftime('%H%M')}"
        f"-{close_et.strftime('%M')}"
    )

def get_next_15m_market_ticker(series: str) -> str:
    later = datetime.now().astimezone(_ET).replace(second=0, microsecond=0) + timedelta(minutes=30)
    quarter = later.minute // 15
    close_et = later.replace(minute=quarter * 15)

    return (
        f"{series}"
        f"-{close_et.strftime('%y')}{close_et.strftime('%b').upper()}{close_et.strftime('%d')}"
        f"{close_et.strftime('%H%M')}"
        f"-{close_et.strftime('%M')}"
    )

def get_last_closed_15m_market_ticker(series: str) -> str:
    earlier = datetime.now().astimezone(_ET).replace(second=0, microsecond=0)
    quarter = earlier.minute // 15
    close_et = earlier.replace(minute=quarter * 15)

    return (
        f"{series}"
        f"-{close_et.strftime('%y')}{close_et.strftime('%b').upper()}{close_et.strftime('%d')}"
        f"{close_et.strftime('%H%M')}"
        f"-{close_et.strftime('%M')}"
    )