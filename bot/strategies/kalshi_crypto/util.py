from datetime import datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


def from_iso_to_ts(iso_time: str) -> float:
  """
  Convert an ISO time string to a timestamp.
  """
  return datetime.fromisoformat(iso_time).timestamp()


def ts_ms_to_time_str(ts_ms: float) -> str:
  return datetime.fromtimestamp(ts_ms / 1000, tz=_ET).strftime('%Y-%m-%d %H:%M:%S %Z')


def countdown_15m() -> str:
  """
  Return ``[MM:SS]`` countdown until the current 15-min window closes.

  The close boundaries are :00, :15, :30, :45 ET.
  If *ts_ms* is ``None``, uses the current wall-clock time.
  """
  now_et = datetime.now(_ET)
  current_min = now_et.minute
  next_boundary = ((current_min // 15) + 1) * 15
  secs_left = (next_boundary - current_min - 1) * 60 + (60 - now_et.second)
  if secs_left == 15 * 60:
      secs_left = 0
  m, s = divmod(secs_left, 60)
  return f"[{m}:{s:02d}]"

def seconds_to_next_15m() -> int:
  """
  Return the number of seconds until the next 15-minute boundary.
  """
  now_et = datetime.now(_ET)
  current_min = now_et.minute
  next_boundary = ((current_min // 15) + 1) * 15
  return (next_boundary - current_min - 1) * 60 + (60 - now_et.second)