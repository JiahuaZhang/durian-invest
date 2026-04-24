from datetime import datetime

def from_iso_to_ts(iso_time: str) -> float:
  """
  Convert an ISO time string to a timestamp.
  """
  return datetime.fromisoformat(iso_time).timestamp()