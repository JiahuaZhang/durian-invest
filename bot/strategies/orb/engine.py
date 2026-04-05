import logging
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, Optional, Any

import pytz
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest, StockLatestBarRequest
from alpaca.data.timeframe import TimeFrame
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

from .config import ORBConfig
from .models import OpeningRange, ORBSignal, ORBTrade
from .filters import BreakoutFilter, build_filters
from .supabase_logger import SupabaseLogger

logger = logging.getLogger(__name__)
ET = pytz.timezone('America/New_York')


class SymbolState(Enum):
    IDLE = 'idle'
    WATCHING_BREAKOUT = 'watching'
    IN_POSITION = 'in_position'


class ORBEngine:
    def __init__(
        self,
        config: ORBConfig,
        trading_client: TradingClient,
        data_client: StockHistoricalDataClient,
        db: SupabaseLogger,
    ):
        self.config = config
        self.trading_client = trading_client
        self.data_client = data_client
        self.db = db
        self.filters: list[BreakoutFilter] = build_filters(config.variant, config.volume_threshold)

        # Per-symbol state
        self.states: Dict[str, SymbolState] = {}
        self.ranges: Dict[str, OpeningRange] = {}
        self.range_ids: Dict[str, str] = {}  # symbol -> supabase row id
        self.trades: Dict[str, ORBTrade] = {}  # symbol -> active trade
        self.avg_volumes: Dict[str, int] = {}
        self.active_position_count = 0

    def reset(self):
        self.states = {s: SymbolState.IDLE for s in self.config.symbols}
        self.ranges.clear()
        self.range_ids.clear()
        self.trades.clear()
        self.avg_volumes.clear()
        self.active_position_count = 0
        logger.info(f"Engine reset for symbols: {self.config.symbols}")

    # --- Opening Range Collection ---

    async def collect_opening_range(self, symbol: str):
        now_et = datetime.now(ET)
        today = now_et.date()

        # Parse range times
        rh, rm = map(int, self.config.range_start.split(':'))
        eh, em = map(int, self.config.range_end.split(':'))
        start = ET.localize(datetime(today.year, today.month, today.day, rh, rm))
        end = ET.localize(datetime(today.year, today.month, today.day, eh, em))

        try:
            request = StockBarsRequest(
                symbol_or_symbols=symbol,
                timeframe=TimeFrame.Minute,
                start=start,
                end=end,
            )
            bars = self.data_client.get_stock_bars(request)
            bar_list = bars[symbol] if symbol in bars else []

            if not bar_list:
                logger.warning(f"No bars for {symbol} in opening range window")
                return

            high = max(b.high for b in bar_list)
            low = min(b.low for b in bar_list)
            open_price = bar_list[0].open
            close_price = bar_list[-1].close
            total_volume = sum(b.volume for b in bar_list)

            # Compute VWAP: sum(typical_price * volume) / sum(volume)
            tp_vol_sum = sum(((b.high + b.low + b.close) / 3) * b.volume for b in bar_list)
            vwap = tp_vol_sum / total_volume if total_volume > 0 else 0

            bars_json = [
                {
                    'time': b.timestamp.isoformat(),
                    'open': float(b.open),
                    'high': float(b.high),
                    'low': float(b.low),
                    'close': float(b.close),
                    'volume': int(b.volume),
                }
                for b in bar_list
            ]

            opening_range = OpeningRange(
                symbol=symbol,
                date=str(today),
                high=float(high),
                low=float(low),
                open=float(open_price),
                close=float(close_price),
                volume=int(total_volume),
                vwap=float(vwap),
                bars=bars_json,
            )

            self.ranges[symbol] = opening_range
            self.states[symbol] = SymbolState.WATCHING_BREAKOUT

            # Fetch 20-day avg volume for volume filter
            self.avg_volumes[symbol] = await self._get_avg_volume(symbol)

            # Log to Supabase
            range_id = await self.db.log_opening_range(opening_range)
            if range_id:
                self.range_ids[symbol] = range_id

            logger.info(
                f"Opening range {symbol}: H={high:.2f} L={low:.2f} "
                f"Size={opening_range.range_size:.2f} ({opening_range.range_pct:.2f}%) "
                f"Dir={opening_range.direction} VWAP={vwap:.2f}"
            )

        except Exception as e:
            logger.error(f"Error collecting opening range for {symbol}: {e}", exc_info=True)

    async def _get_avg_volume(self, symbol: str, lookback: int = 20) -> int:
        try:
            end = datetime.now(ET) - timedelta(days=1)
            start = end - timedelta(days=lookback * 2)  # extra days for weekends/holidays
            request = StockBarsRequest(
                symbol_or_symbols=symbol,
                timeframe=TimeFrame.Day,
                start=start,
                end=end,
                limit=lookback,
            )
            bars = self.data_client.get_stock_bars(request)
            bar_list = bars[symbol] if symbol in bars else []
            if not bar_list:
                return 0
            return int(sum(b.volume for b in bar_list) / len(bar_list))
        except Exception as e:
            logger.error(f"Error fetching avg volume for {symbol}: {e}")
            return 0

    # --- Breakout Detection ---

    async def check_breakout(self, symbol: str) -> Optional[ORBSignal]:
        if self.states.get(symbol) != SymbolState.WATCHING_BREAKOUT:
            return None

        opening_range = self.ranges.get(symbol)
        if not opening_range:
            return None

        try:
            request = StockLatestBarRequest(symbol_or_symbols=symbol)
            latest = self.data_client.get_stock_latest_bar(request)
            bar = latest[symbol] if symbol in latest else None
            if not bar:
                return None

            bar_data = {
                'open': float(bar.open),
                'high': float(bar.high),
                'low': float(bar.low),
                'close': float(bar.close),
                'volume': int(bar.volume),
                'timestamp': bar.timestamp.isoformat(),
            }

            # Check breakout direction
            direction = None
            breakout_price = 0
            if bar.high > opening_range.high:
                direction = 'long'
                breakout_price = float(bar.close)
            elif bar.low < opening_range.low:
                direction = 'short'
                breakout_price = float(bar.close)

            if not direction:
                return None

            # Compute running VWAP for context
            current_vwap = await self._compute_running_vwap(symbol)

            context = {
                'direction': direction,
                'avg_volume_20d': self.avg_volumes.get(symbol, 0),
                'current_vwap': current_vwap,
            }

            # Evaluate filters
            filter_results = {}
            all_passed = True
            for f in self.filters:
                passed = f.evaluate(bar_data, opening_range, context)
                filter_results[f.get_name()] = passed
                if not passed:
                    all_passed = False

            now_et = datetime.now(ET)
            signal = ORBSignal(
                range_id=self.range_ids.get(symbol),
                symbol=symbol,
                date=str(now_et.date()),
                signal_time=now_et.isoformat(),
                direction=direction,
                breakout_price=breakout_price,
                range_high=opening_range.high,
                range_low=opening_range.low,
                range_size=opening_range.range_size,
                body_close_confirmed=filter_results.get('body_close'),
                volume_confirmed=filter_results.get('volume'),
                vwap_confirmed=filter_results.get('vwap'),
                all_filters_passed=all_passed,
                vwap_at_signal=current_vwap,
                volume_at_signal=int(bar.volume),
                avg_volume_20d=self.avg_volumes.get(symbol),
                variant=self.config.variant,
                day_of_week=now_et.strftime('%A'),
            )

            # Log ALL signals (even rejected ones) for post-hoc analysis
            await self.db.log_signal(signal)

            if all_passed:
                logger.info(f"BREAKOUT {direction.upper()} {symbol} @ {breakout_price:.2f} - ALL FILTERS PASSED")
            else:
                failed = [k for k, v in filter_results.items() if not v]
                logger.info(f"Breakout {direction} {symbol} @ {breakout_price:.2f} - REJECTED by: {failed}")

            return signal

        except Exception as e:
            logger.error(f"Error checking breakout for {symbol}: {e}", exc_info=True)
            return None

    async def _compute_running_vwap(self, symbol: str) -> float:
        try:
            now_et = datetime.now(ET)
            today = now_et.date()
            market_open = ET.localize(datetime(today.year, today.month, today.day, 9, 30))

            request = StockBarsRequest(
                symbol_or_symbols=symbol,
                timeframe=TimeFrame.Minute,
                start=market_open,
                end=now_et,
            )
            bars = self.data_client.get_stock_bars(request)
            bar_list = bars[symbol] if symbol in bars else []
            if not bar_list:
                return 0

            tp_vol_sum = sum(((b.high + b.low + b.close) / 3) * b.volume for b in bar_list)
            vol_sum = sum(b.volume for b in bar_list)
            return tp_vol_sum / vol_sum if vol_sum > 0 else 0
        except Exception as e:
            logger.error(f"Error computing VWAP for {symbol}: {e}")
            return 0

    # --- Position Management ---

    async def enter_position(self, signal: ORBSignal) -> Optional[ORBTrade]:
        if self.active_position_count >= self.config.max_positions:
            logger.info(f"Max positions ({self.config.max_positions}) reached, skipping {signal.symbol}")
            return None

        try:
            account = self.trading_client.get_account()
            equity = float(account.equity)
            notional = equity * self.config.position_size_pct

            side = OrderSide.BUY if signal.direction == 'long' else OrderSide.SELL
            entry_price = signal.breakout_price

            # Compute stop loss and take profit
            if self.config.use_range_stop:
                if signal.direction == 'long':
                    stop_loss = signal.range_low
                    take_profit = entry_price + (signal.range_size * self.config.take_profit_mult)
                else:
                    stop_loss = signal.range_high
                    take_profit = entry_price - (signal.range_size * self.config.take_profit_mult)
            else:
                if signal.direction == 'long':
                    stop_loss = entry_price - signal.range_size
                    take_profit = entry_price + (signal.range_size * self.config.take_profit_mult)
                else:
                    stop_loss = entry_price + signal.range_size
                    take_profit = entry_price - (signal.range_size * self.config.take_profit_mult)

            # Submit order
            order_request = MarketOrderRequest(
                symbol=signal.symbol,
                notional=round(notional, 2),
                side=side,
                time_in_force=TimeInForce.DAY,
            )
            order = self.trading_client.submit_order(order_data=order_request)

            now_et = datetime.now(ET)
            trade = ORBTrade(
                signal_id=signal.id,
                symbol=signal.symbol,
                date=str(now_et.date()),
                variant=self.config.variant,
                entry_time=now_et.isoformat(),
                entry_price=entry_price,
                entry_side='buy' if side == OrderSide.BUY else 'sell',
                qty=round(notional / entry_price, 4) if entry_price > 0 else 0,
                stop_loss_price=stop_loss,
                take_profit_price=take_profit,
                entry_order_id=str(order.id),
                status='open',
            )

            self.trades[signal.symbol] = trade
            self.states[signal.symbol] = SymbolState.IN_POSITION
            self.active_position_count += 1

            await self.db.log_trade(trade)

            logger.info(
                f"ENTERED {trade.entry_side.upper()} {signal.symbol} "
                f"~${notional:,.0f} @ {entry_price:.2f} | "
                f"SL={stop_loss:.2f} TP={take_profit:.2f}"
            )
            return trade

        except Exception as e:
            logger.error(f"Error entering position for {signal.symbol}: {e}", exc_info=True)
            return None

    async def manage_position(self, symbol: str):
        if self.states.get(symbol) != SymbolState.IN_POSITION:
            return

        trade = self.trades.get(symbol)
        if not trade:
            return

        try:
            request = StockLatestBarRequest(symbol_or_symbols=symbol)
            latest = self.data_client.get_stock_latest_bar(request)
            bar = latest[symbol] if symbol in latest else None
            if not bar:
                return

            current_price = float(bar.close)

            if trade.entry_side == 'buy':
                if current_price <= trade.stop_loss_price:
                    await self.close_position(symbol, 'stop_loss', current_price)
                elif current_price >= trade.take_profit_price:
                    await self.close_position(symbol, 'take_profit', current_price)
            else:  # sell (short)
                if current_price >= trade.stop_loss_price:
                    await self.close_position(symbol, 'stop_loss', current_price)
                elif current_price <= trade.take_profit_price:
                    await self.close_position(symbol, 'take_profit', current_price)

        except Exception as e:
            logger.error(f"Error managing position for {symbol}: {e}")

    async def close_position(self, symbol: str, reason: str, exit_price: float = 0):
        trade = self.trades.get(symbol)
        if not trade:
            return

        try:
            # Close via Alpaca
            self.trading_client.close_position(symbol)

            now_et = datetime.now(ET)

            # Compute P&L
            if exit_price > 0:
                if trade.entry_side == 'buy':
                    pnl = (exit_price - trade.entry_price) * trade.qty
                    pnl_pct = ((exit_price - trade.entry_price) / trade.entry_price) * 100
                else:
                    pnl = (trade.entry_price - exit_price) * trade.qty
                    pnl_pct = ((trade.entry_price - exit_price) / trade.entry_price) * 100
            else:
                pnl = 0
                pnl_pct = 0

            updates = {
                'exit_time': now_et.isoformat(),
                'exit_price': exit_price,
                'exit_reason': reason,
                'pnl': round(pnl, 2),
                'pnl_pct': round(pnl_pct, 4),
                'status': 'closed',
            }
            await self.db.update_trade(trade.id, updates)

            trade.exit_time = updates['exit_time']
            trade.exit_price = exit_price
            trade.exit_reason = reason
            trade.pnl = pnl
            trade.pnl_pct = pnl_pct
            trade.status = 'closed'

            self.states[symbol] = SymbolState.IDLE
            self.active_position_count = max(0, self.active_position_count - 1)

            emoji = '🟢' if pnl >= 0 else '🔴'
            logger.info(
                f"{emoji} CLOSED {symbol} [{reason}] @ {exit_price:.2f} | "
                f"P&L: ${pnl:+,.2f} ({pnl_pct:+.2f}%)"
            )

        except Exception as e:
            logger.error(f"Error closing position for {symbol}: {e}", exc_info=True)

    async def close_eod(self, symbol: str):
        if self.states.get(symbol) == SymbolState.IN_POSITION:
            try:
                request = StockLatestBarRequest(symbol_or_symbols=symbol)
                latest = self.data_client.get_stock_latest_bar(request)
                bar = latest[symbol] if symbol in latest else None
                exit_price = float(bar.close) if bar else 0
            except Exception:
                exit_price = 0
            await self.close_position(symbol, 'eod_close', exit_price)

    # --- Daily Summary ---

    async def generate_daily_summary(self) -> Dict[str, Any]:
        now_et = datetime.now(ET)
        date_str = str(now_et.date())

        trades_today = [t for t in self.trades.values() if t.date == date_str and t.status == 'closed']
        won = sum(1 for t in trades_today if t.pnl and t.pnl > 0)
        lost = sum(1 for t in trades_today if t.pnl and t.pnl <= 0)
        total_pnl = sum(t.pnl for t in trades_today if t.pnl)

        ranges_today = [r for r in self.ranges.values()]
        avg_range = sum(r.range_size for r in ranges_today) / len(ranges_today) if ranges_today else 0

        summary = {
            'symbols': self.config.symbols,
            'variant': self.config.variant,
            'total_signals': 0,  # filled by strategy from signal count
            'signals_passed': 0,
            'trades_taken': len(trades_today),
            'trades_won': won,
            'trades_lost': lost,
            'total_pnl': round(total_pnl, 2),
            'win_rate': round(won / len(trades_today) * 100, 1) if trades_today else 0,
            'avg_range_size': round(avg_range, 2),
        }

        await self.db.log_daily_summary(date_str, summary)

        logger.info(
            f"Daily Summary: {len(trades_today)} trades | "
            f"Won: {won} | Lost: {lost} | "
            f"P&L: ${total_pnl:+,.2f} | Win Rate: {summary['win_rate']}%"
        )

        return summary
