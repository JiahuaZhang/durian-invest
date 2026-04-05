import logging
import asyncio
from typing import Optional, Dict, Any

from supabase import create_client, Client

from .models import OpeningRange, ORBSignal, ORBTrade

logger = logging.getLogger(__name__)


class SupabaseLogger:
    def __init__(self, url: str, key: str):
        self.client: Client = create_client(url, key)

    def _run_sync(self, fn):
        return asyncio.get_event_loop().run_in_executor(None, fn)

    async def log_opening_range(self, r: OpeningRange) -> Optional[str]:
        try:
            data = {
                'symbol': r.symbol,
                'date': r.date,
                'high': float(r.high),
                'low': float(r.low),
                'open': float(r.open),
                'close': float(r.close),
                'volume': r.volume,
                'vwap': float(r.vwap) if r.vwap else None,
                'range_size': float(r.range_size),
                'range_pct': float(r.range_pct),
                'direction': r.direction,
                'bars_json': r.bars,
            }
            result = await self._run_sync(
                lambda: self.client.table('orb_opening_ranges').upsert(
                    data, on_conflict='symbol,date'
                ).execute()
            )
            row_id = result.data[0]['id'] if result.data else None
            logger.info(f"Logged opening range for {r.symbol}: {r.range_size:.2f} ({r.direction})")
            return row_id
        except Exception as e:
            logger.error(f"Failed to log opening range: {e}")
            return None

    async def log_signal(self, signal: ORBSignal) -> Optional[str]:
        try:
            data = {
                'id': signal.id,
                'range_id': signal.range_id,
                'symbol': signal.symbol,
                'date': signal.date,
                'signal_time': signal.signal_time,
                'direction': signal.direction,
                'breakout_price': float(signal.breakout_price),
                'range_high': float(signal.range_high),
                'range_low': float(signal.range_low),
                'range_size': float(signal.range_size),
                'body_close_confirmed': signal.body_close_confirmed,
                'volume_confirmed': signal.volume_confirmed,
                'vwap_confirmed': signal.vwap_confirmed,
                'all_filters_passed': signal.all_filters_passed,
                'vwap_at_signal': float(signal.vwap_at_signal) if signal.vwap_at_signal else None,
                'volume_at_signal': signal.volume_at_signal,
                'avg_volume_20d': signal.avg_volume_20d,
                'variant': signal.variant,
                'day_of_week': signal.day_of_week,
            }
            await self._run_sync(
                lambda: self.client.table('orb_signals').insert(data).execute()
            )
            status = "PASSED" if signal.all_filters_passed else "REJECTED"
            logger.info(f"Logged signal [{status}] {signal.direction} {signal.symbol} @ {signal.breakout_price:.2f}")
            return signal.id
        except Exception as e:
            logger.error(f"Failed to log signal: {e}")
            return None

    async def log_trade(self, trade: ORBTrade) -> Optional[str]:
        try:
            data = {
                'id': trade.id,
                'signal_id': trade.signal_id,
                'symbol': trade.symbol,
                'date': trade.date,
                'variant': trade.variant,
                'entry_time': trade.entry_time,
                'entry_price': float(trade.entry_price),
                'entry_side': trade.entry_side,
                'qty': float(trade.qty),
                'stop_loss_price': float(trade.stop_loss_price),
                'take_profit_price': float(trade.take_profit_price),
                'entry_order_id': trade.entry_order_id,
                'status': trade.status,
            }
            await self._run_sync(
                lambda: self.client.table('orb_trades').insert(data).execute()
            )
            logger.info(f"Logged trade {trade.entry_side.upper()} {trade.symbol} x{trade.qty:.2f} @ {trade.entry_price:.2f}")
            return trade.id
        except Exception as e:
            logger.error(f"Failed to log trade: {e}")
            return None

    async def update_trade(self, trade_id: str, updates: Dict[str, Any]):
        try:
            await self._run_sync(
                lambda: self.client.table('orb_trades').update(updates).eq('id', trade_id).execute()
            )
            logger.info(f"Updated trade {trade_id}: {updates.get('exit_reason', 'update')}")
        except Exception as e:
            logger.error(f"Failed to update trade {trade_id}: {e}")

    async def log_daily_summary(self, date_str: str, summary: Dict[str, Any]):
        try:
            data = {'date': date_str, **summary}
            await self._run_sync(
                lambda: self.client.table('orb_daily_summaries').upsert(
                    data, on_conflict='date'
                ).execute()
            )
            logger.info(f"Logged daily summary for {date_str}")
        except Exception as e:
            logger.error(f"Failed to log daily summary: {e}")
