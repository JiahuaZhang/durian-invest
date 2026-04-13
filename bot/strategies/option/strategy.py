"""
Option Strategy
===============
Systematic index put selling with volatility quality filters.

Checks every Monday (and Tuesday as fallback) whether conditions are favorable
to sell an OTM put on the configured symbols. When conditions pass, a Telegram
notification is sent with the full assessment. No automated trading — all
execution is manual.

Schedule (all times ET, Mon–Fri only):
  Mon 9:25  pre_market_setup  — reset weekly state
  Mon 10:00 monday_check      — check signal for all symbols
  Tue 10:00 tuesday_check     — fallback check (if Monday conditions were not met)
  Fri 15:55 weekly_summary    — log how many signals fired this week

Filters (all three must pass):
  1. Trend:       price above 50-day MA (configurable; skip if disabled)
  2. IV Rank:     implied volatility rank in [ivr_min, ivr_max] (default 30–70)
  3. IV-RV spread: implied volatility exceeds realized volatility by >= iv_rv_min_spread pp

Why sell puts, not calls?
  Equity indexes have a structural upward drift over time. Selling puts benefits
  from both this drift (underlying moves away from strike) and from the
  volatility risk premium (implied volatility > realized volatility ~88% of days).
  The CBOE PUT index has a 40-year Sharpe of 0.65 vs SPX at 0.49.
"""

import os
import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List

from dotenv import load_dotenv
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

from ..base_strategy import TradingStrategy
from ..registry import StrategyRegistry
from ..telegram_notifier import TelegramNotifier
from .config import OptionConfig
from .engine import OptionEngine
from .market_calendar import is_trading_day

logger = logging.getLogger(__name__)
ET = pytz.timezone('America/New_York')

load_dotenv()


class OptionStrategy(TradingStrategy):
    def __init__(self, **config_overrides):
        super().__init__(**config_overrides)
        self.config = OptionConfig.from_env()
        self.engine: OptionEngine = None
        self.scheduler = None
        self._weekly_signals: List[dict] = []

        logger.info(
            "Option strategy configured: symbols=%s check_time=%s "
            "IVR=[%.0f–%.0f] IV-RV>=%.1fpp wing=%.0f%% trend_filter=%s",
            self.config.symbols, self.config.check_time,
            self.config.ivr_min, self.config.ivr_max,
            self.config.iv_rv_min_spread, self.config.wing_pct * 100,
            self.config.trend_filter,
        )

    def get_name(self) -> str:
        return 'option'

    def get_type(self) -> str:
        return 'scheduled'

    async def initialize(self):
        notifier = TelegramNotifier(self.config.telegram_token, self.config.telegram_chat_id)
        self.engine = OptionEngine(config=self.config, notifier=notifier)
        self.scheduler = AsyncIOScheduler()
        logger.info('Option strategy initialized')

    def is_ready(self) -> bool:
        return self.engine is not None

    async def start(self):
        if not self.is_ready():
            raise RuntimeError('Strategy not initialized')

        self.is_running = True

        h_check, m_check = map(int, self.config.check_time.split(':'))

        jobs = [
            ('option_premarket',  'mon',     9,       25,      self._pre_market_setup, 'Pre-market setup'),
            ('option_mon_check',  'mon',     h_check, m_check, self._monday_check,     'Monday signal check'),
            ('option_tue_check',  'tue',     h_check, m_check, self._tuesday_check,    'Tuesday signal check'),
            ('option_fri_sum',    'fri',     15,      55,      self._weekly_summary,   'Friday summary'),
        ]

        for job_id, dow, hour, minute, handler, name in jobs:
            self.scheduler.add_job(
                handler,
                CronTrigger(day_of_week=dow, hour=hour, minute=minute, timezone='America/New_York'),
                id=job_id,
                name=name,
            )

        self.scheduler.start()

        now = datetime.now(ET)
        for job_id, *_ in jobs:
            job = self.scheduler.get_job(job_id)
            if job and job.trigger:
                next_run = job.trigger.get_next_fire_time(None, now)
                if next_run:
                    logger.info("  %s: next at %s", job.name, next_run.strftime('%Y-%m-%d %I:%M %p %Z'))

        try:
            while self.is_running:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            logger.info('Option strategy cancelled')

    async def stop(self):
        self.is_running = False
        if self.scheduler:
            self.scheduler.shutdown(wait=False)
        logger.info('Option strategy stopped')

    # ─── Scheduled handlers ──────────────────────────────────────────────────

    async def _pre_market_setup(self):
        today = datetime.now(ET).date()
        if not is_trading_day(today):
            return
        logger.info('=' * 60)
        logger.info('OPTION PRE-MARKET SETUP')
        logger.info('  Symbols:        %s', self.config.symbols)
        logger.info('  Check time:     %s ET', self.config.check_time)
        logger.info('  IV Rank range:  %.0f – %.0f', self.config.ivr_min, self.config.ivr_max)
        logger.info('  IV-RV minimum:  %.1f pp', self.config.iv_rv_min_spread)
        logger.info('  Wing:           %.0f%% OTM', self.config.wing_pct * 100)
        logger.info('  Trend filter:   %s', 'on' if self.config.trend_filter else 'off')
        logger.info('=' * 60)
        self.engine.reset()
        self._weekly_signals.clear()

    async def _monday_check(self):
        today = datetime.now(ET).date()
        if not is_trading_day(today):
            return
        logger.info('Option: Monday signal check...')
        for symbol in self.config.symbols:
            signal = await self.engine.check_signal(symbol, 'Monday')
            if signal.all_passed:
                self._weekly_signals.append({
                    'symbol': signal.symbol,
                    'day':    signal.day_of_week,
                    'strike': signal.suggested_strike,
                    'expiry': signal.expiry_date,
                    'ivr':    signal.iv_rank,
                    'iv_rv':  signal.iv_rv_spread,
                })

    async def _tuesday_check(self):
        today = datetime.now(ET).date()
        if not is_trading_day(today) or not self.config.tuesday_fallback:
            return

        # Only check symbols that did not already get a Monday signal
        already_signalled = {s['symbol'] for s in self._weekly_signals}
        pending = [sym for sym in self.config.symbols if sym not in already_signalled]
        if not pending:
            logger.info('Option: all symbols already signalled Monday, skipping Tuesday check')
            return

        logger.info('Option: Tuesday fallback check for %s...', pending)
        for symbol in pending:
            signal = await self.engine.check_signal(symbol, 'Tuesday')
            if signal.all_passed:
                self._weekly_signals.append({
                    'symbol': signal.symbol,
                    'day':    signal.day_of_week,
                    'strike': signal.suggested_strike,
                    'expiry': signal.expiry_date,
                    'ivr':    signal.iv_rank,
                    'iv_rv':  signal.iv_rv_spread,
                })

    async def _weekly_summary(self):
        today = datetime.now(ET).date()
        if not is_trading_day(today):
            return
        n = len(self._weekly_signals)
        if n == 0:
            logger.info('Option weekly summary: no signals fired this week')
        else:
            for s in self._weekly_signals:
                logger.info(
                    "  Signal: %s sell PUT strike=%.2f exp=%s IVR=%.0f IV-RV=+%.1fpp",
                    s['symbol'], s['strike'], s['expiry'], s['ivr'], s['iv_rv'],
                )
        logger.info('Option weekly summary: %d signal(s) total', n)

    # ─── Stats ────────────────────────────────────────────────────────────────

    def get_stats(self) -> Dict[str, Any]:
        return {
            'strategy':        self.get_name(),
            'symbols':         self.config.symbols,
            'scheduler':       self.scheduler.running if self.scheduler else False,
            'weekly_signals':  len(self._weekly_signals),
            'signals_detail':  self._weekly_signals,
        }


StrategyRegistry.register('option', OptionStrategy)
