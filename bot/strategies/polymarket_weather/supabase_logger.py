import asyncio
import logging
from typing import Any, Dict, Optional

from supabase import create_client, Client

from .models import WeatherSignal, WeatherBet, WeatherResolution

logger = logging.getLogger(__name__)


class SupabaseLogger:
    def __init__(self, url: str, key: str):
        self.client: Client = create_client(url, key)

    def _run_sync(self, fn):
        return asyncio.get_event_loop().run_in_executor(None, fn)

    async def log_signal(self, s: WeatherSignal) -> Optional[str]:
        try:
            data = {
                "id": s.id,
                "detected_at": s.detected_at,
                "market_ticker": s.market_ticker,
                "city": s.city,
                "icao": s.icao,
                "metric": s.metric,
                "threshold": s.threshold,
                "target_date": s.target_date,
                "metar_temp_f": s.metar_temp_f,
                "nws_forecast_value": s.nws_forecast_value,
                "our_probability": s.our_probability,
                "market_yes_price": s.market_yes_price,
                "edge": s.edge,
                "action": s.action,
            }
            await self._run_sync(
                lambda: self.client.table("weather_signals").insert(data).execute()
            )
            logger.info(f"Signal logged: {s.action} {s.market_ticker} edge={s.edge:.2f}")
            return s.id
        except Exception as e:
            logger.error(f"Failed to log signal: {e}")
            return None

    async def log_bet(self, b: WeatherBet) -> Optional[str]:
        try:
            data = {
                "id": b.id,
                "signal_id": b.signal_id,
                "placed_at": b.placed_at,
                "market_ticker": b.market_ticker,
                "side": b.side,
                "contracts": b.contracts,
                "price_per_contract": b.price_per_contract,
                "total_cost": b.total_cost,
                "kalshi_order_id": b.kalshi_order_id,
                "status": b.status,
            }
            await self._run_sync(
                lambda: self.client.table("weather_bets").insert(data).execute()
            )
            logger.info(
                f"Bet logged: {b.side.upper()} {b.contracts}x {b.market_ticker} "
                f"@ {b.price_per_contract:.2f} (${b.total_cost:.2f})"
            )
            return b.id
        except Exception as e:
            logger.error(f"Failed to log bet: {e}")
            return None

    async def update_bet_status(self, bet_id: str, status: str, kalshi_order_id: str = ""):
        try:
            updates: Dict[str, Any] = {"status": status}
            if kalshi_order_id:
                updates["kalshi_order_id"] = kalshi_order_id
            await self._run_sync(
                lambda: self.client.table("weather_bets").update(updates).eq("id", bet_id).execute()
            )
        except Exception as e:
            logger.error(f"Failed to update bet {bet_id}: {e}")

    async def log_resolution(self, r: WeatherResolution) -> Optional[str]:
        try:
            data = {
                "id": r.id,
                "bet_id": r.bet_id,
                "resolved_at": r.resolved_at,
                "market_ticker": r.market_ticker,
                "outcome": r.outcome,
                "won": r.won,
                "payout": r.payout,
                "profit_loss": r.profit_loss,
                "actual_weather_value": r.actual_weather_value,
            }
            await self._run_sync(
                lambda: self.client.table("weather_resolutions").insert(data).execute()
            )
            status = "WIN" if r.won else "LOSS"
            logger.info(
                f"Resolution logged [{status}]: {r.market_ticker} "
                f"P&L=${r.profit_loss:+.2f}"
            )
            return r.id
        except Exception as e:
            logger.error(f"Failed to log resolution: {e}")
            return None
