"""
Fetches aviation METAR data and NWS point forecasts.

METAR API: https://aviationweather.gov/data/api/ — no auth required
NWS API:   https://api.weather.gov — no auth required
"""
import logging
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

# METAR T-group encodes temp/dewpoint to 0.1°C: T02560189
# First digit: 0=positive, 1=negative; next 3 digits = tenths of °C
def _parse_metar_t_group(raw: str) -> Optional[float]:
    """Extract temperature in °C from METAR T-group string (e.g. 'T02560189')."""
    try:
        sign = -1 if raw[1] == '1' else 1
        temp_c = sign * int(raw[2:5]) / 10.0
        return temp_c
    except (IndexError, ValueError):
        return None


def _c_to_f(c: float) -> float:
    return c * 9 / 5 + 32


class WeatherClient:
    METAR_URL = "https://aviationweather.gov/data/api/metar"
    NWS_POINTS_URL = "https://api.weather.gov/points/{lat},{lon}"
    NWS_FORECAST_URL = "https://api.weather.gov/gridpoints/{office}/{x},{y}/forecast"

    def __init__(self):
        self._client = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "durian-invest-bot/1.0"})

    async def close(self):
        await self._client.aclose()

    async def get_metar_temp_f(self, icao: str) -> Optional[float]:
        """Return current temperature in °F from METAR, or None on failure."""
        try:
            resp = await self._client.get(self.METAR_URL, params={"ids": icao, "format": "json"})
            resp.raise_for_status()
            data = resp.json()
            if not data:
                return None

            obs = data[0]

            # Prefer T-group (0.1°C precision) in remarks
            remarks = obs.get("rawOb", "")
            for token in remarks.split():
                if len(token) == 9 and token[0] == "T" and token[1] in ("0", "1"):
                    temp_c = _parse_metar_t_group(token)
                    if temp_c is not None:
                        logger.debug(f"METAR {icao}: {temp_c:.1f}°C (T-group)")
                        return _c_to_f(temp_c)

            # Fallback: integer temp field
            temp_c = obs.get("temp")
            if temp_c is not None:
                return _c_to_f(float(temp_c))

            return None
        except Exception as e:
            logger.warning(f"METAR fetch failed for {icao}: {e}")
            return None

    async def get_nws_forecast_high_f(self, lat: float, lon: float, target_date: str) -> Optional[float]:
        """
        Return NWS forecast high temperature in °F for the given date.
        target_date: YYYY-MM-DD
        """
        try:
            points_resp = await self._client.get(self.NWS_POINTS_URL.format(lat=lat, lon=lon))
            points_resp.raise_for_status()
            props = points_resp.json()["properties"]
            office = props["gridId"]
            x = props["gridX"]
            y = props["gridY"]

            forecast_resp = await self._client.get(
                self.NWS_FORECAST_URL.format(office=office, x=x, y=y)
            )
            forecast_resp.raise_for_status()
            periods = forecast_resp.json()["properties"]["periods"]

            for period in periods:
                if period["isDaytime"] and target_date in period.get("startTime", ""):
                    temp = period["temperature"]
                    unit = period["temperatureUnit"]
                    if unit == "C":
                        return _c_to_f(temp)
                    return float(temp)

            return None
        except Exception as e:
            logger.warning(f"NWS forecast failed for ({lat},{lon}) on {target_date}: {e}")
            return None
