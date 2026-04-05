import os
import asyncio
import logging
from datetime import datetime
from typing import Dict, Any

from dotenv import load_dotenv
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from alpaca.trading.client import TradingClient
from alpaca.data.historical import StockHistoricalDataClient

from ..base_strategy import TradingStrategy
from ..registry import StrategyRegistry
from .config import ORBConfig
from .engine import ORBEngine, SymbolState
from .supabase_logger import SupabaseLogger
from .market_calendar import is_trading_day

logger = logging.getLogger(__name__)

load_dotenv()


class ORBStrategy(TradingStrategy):
    def __init__(self, **config_overrides):
        super().__init__(**config_overrides)
        self.config = ORBConfig.from_env()
        self.trading_client = None
        self.data_client = None
        self.engine = None
        self.scheduler = None
        self._poll_tasks: list[asyncio.Task] = []
        self._accepting_entries = False

        logger.info(
            f"ORB configured: symbols={self.config.symbols}, variant={self.config.variant}, "
            f"range={self.config.range_start}-{self.config.range_end}"
        )

    def get_name(self) -> str:
        return "orb"

    def get_type(self) -> str:
        return "scheduled"

    async def initialize(self):
        alpaca_key = os.getenv("ALPACA_API_KEY")
        alpaca_secret = os.getenv("ALPACA_SECRET_KEY")

        if not all([alpaca_key, alpaca_secret]):
            raise ValueError("ALPACA_API_KEY and ALPACA_SECRET_KEY required")

        self.trading_client = TradingClient(
            api_key=alpaca_key,
            secret_key=alpaca_secret,
            paper=True,
        )

        self.data_client = StockHistoricalDataClient(
            api_key=alpaca_key,
            secret_key=alpaca_secret,
        )

        if not self.config.supabase_url or not self.config.supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")

        db = SupabaseLogger(self.config.supabase_url, self.config.supabase_key)

        self.engine = ORBEngine(
            config=self.config,
            trading_client=self.trading_client,
            data_client=self.data_client,
            db=db,
        )

        self.scheduler = AsyncIOScheduler()
        logger.info("ORB strategy initialized")

    def is_ready(self) -> bool:
        return self.engine is not None

    async def start(self):
        if not self.is_ready():
            raise RuntimeError("Strategy not initialized")

        self.is_running = True

        # Schedule daily jobs (all ET, weekdays only)
        jobs = [
            ('orb_pre_market',    9, 25, self._pre_market_setup,  'Pre-market setup'),
            ('orb_collect_range', 9, 46, self._collect_ranges,    'Collect opening ranges'),
            ('orb_start_monitor', 9, 47, self._start_monitoring,  'Start breakout monitoring'),
            ('orb_stop_entries', 15, 30, self._stop_entries,      'Stop new entries'),
            ('orb_eod_close',    15, 45, self._eod_close,         'EOD close positions'),
            ('orb_daily_summary',15, 50, self._daily_summary,     'Daily summary'),
        ]

        for job_id, hour, minute, handler, name in jobs:
            self.scheduler.add_job(
                handler,
                CronTrigger(
                    day_of_week='mon-fri',
                    hour=hour,
                    minute=minute,
                    timezone='America/New_York',
                ),
                id=job_id,
                name=name,
            )

        self.scheduler.start()

        # Log next run times
        import pytz
        et = pytz.timezone('America/New_York')
        now = datetime.now(et)
        for job_id, *_ in jobs:
            job = self.scheduler.get_job(job_id)
            if job and job.trigger:
                next_run = job.trigger.get_next_fire_time(None, now)
                if next_run:
                    logger.info(f"  {job.name}: next at {next_run.strftime('%Y-%m-%d %I:%M %p %Z')}")

        # Keep alive
        try:
            while self.is_running:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            logger.info("ORB strategy cancelled")

    async def stop(self):
        self.is_running = False
        self._accepting_entries = False

        # Cancel poll tasks
        for task in self._poll_tasks:
            if not task.done():
                task.cancel()
        self._poll_tasks.clear()

        # Close any open positions
        if self.engine:
            for symbol in self.config.symbols:
                await self.engine.close_eod(symbol)

        if self.scheduler:
            self.scheduler.shutdown(wait=False)

        logger.info("ORB strategy stopped")

    # --- Scheduled Handlers ---

    async def _pre_market_setup(self):
        today = datetime.now().date()
        if not is_trading_day(today):
            logger.info(f"Not a trading day ({today}), skipping")
            return

        logger.info("=" * 60)
        logger.info("ORB PRE-MARKET SETUP")
        logger.info(f"  Symbols: {self.config.symbols}")
        logger.info(f"  Variant: {self.config.variant}")
        logger.info(f"  Range: {self.config.range_start}-{self.config.range_end} ET")
        logger.info("=" * 60)

        self.engine.reset()
        self._accepting_entries = True

    async def _collect_ranges(self):
        today = datetime.now().date()
        if not is_trading_day(today):
            return

        logger.info("Collecting opening ranges...")
        for symbol in self.config.symbols:
            await self.engine.collect_opening_range(symbol)

    async def _start_monitoring(self):
        today = datetime.now().date()
        if not is_trading_day(today):
            return

        logger.info("Starting breakout monitoring...")

        # Cancel any existing poll tasks
        for task in self._poll_tasks:
            if not task.done():
                task.cancel()
        self._poll_tasks.clear()

        for symbol in self.config.symbols:
            task = asyncio.create_task(self._poll_loop(symbol))
            self._poll_tasks.append(task)

    async def _poll_loop(self, symbol: str):
        logger.info(f"Poll loop started for {symbol} (every {self.config.poll_interval_sec}s)")
        try:
            while self.is_running:
                state = self.engine.states.get(symbol)

                if state == SymbolState.WATCHING_BREAKOUT and self._accepting_entries:
                    signal = await self.engine.check_breakout(symbol)
                    if signal and signal.all_filters_passed:
                        await self.engine.enter_position(signal)

                elif state == SymbolState.IN_POSITION:
                    await self.engine.manage_position(symbol)

                await asyncio.sleep(self.config.poll_interval_sec)
        except asyncio.CancelledError:
            logger.info(f"Poll loop ended for {symbol}")

    async def _stop_entries(self):
        self._accepting_entries = False
        logger.info("Stopped accepting new entries (15:30 ET)")

    async def _eod_close(self):
        logger.info("EOD close - closing all open positions")
        for symbol in self.config.symbols:
            await self.engine.close_eod(symbol)

        # Cancel poll tasks
        for task in self._poll_tasks:
            if not task.done():
                task.cancel()
        self._poll_tasks.clear()

    async def _daily_summary(self):
        await self.engine.generate_daily_summary()
        logger.info("Trading day complete")

    def get_stats(self) -> Dict[str, Any]:
        stats = {
            'strategy': self.get_name(),
            'symbols': self.config.symbols,
            'variant': self.config.variant,
            'accepting_entries': self._accepting_entries,
            'scheduler_running': self.scheduler.running if self.scheduler else False,
        }

        if self.engine:
            stats['states'] = {s: st.value for s, st in self.engine.states.items()}
            stats['active_positions'] = self.engine.active_position_count

        if self.trading_client:
            try:
                account = self.trading_client.get_account()
                stats['equity'] = float(account.equity)
                stats['cash'] = float(account.cash)
            except Exception:
                pass

        return stats


# Register with the strategy registry
StrategyRegistry.register('orb', ORBStrategy)
