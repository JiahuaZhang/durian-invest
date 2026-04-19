from datetime import datetime
from zoneinfo import ZoneInfo

ny_tz = ZoneInfo("America/New_York")

def convert_utc_to_ny(utc_time_str: str, output_format: str = "%Y-%m-%d %I:%M:%S %p %Z") -> str:
    """
    Converts a UTC ISO-8601 time string to a formatted New York time string.
    
    Args:
        utc_time_str (str): The UTC time string (e.g., '2026-04-19T03:06:09.181051Z')
        output_format (str): The desired output datetime format. 
                             Defaults to 'YYYY-MM-DD HH:MM:SS AM/PM TZ'.
                             
    Returns:
        str: The converted and formatted time string.
    """
    try:
        safe_time_str = utc_time_str.replace("Z", "+00:00")
        utc_dt = datetime.fromisoformat(safe_time_str)
        ny_dt = utc_dt.astimezone(ny_tz)
        return ny_dt.strftime(output_format)
    except ValueError as e:
        return f"Invalid time string provided: {e}"
