"""
KalshiCryptoStrategy — coordinator for the 15-min crypto prediction bot.

Architecture:
  CandleCache      — shared price data, refreshed at cron :25s and :55s
  SharedState      — account state (balance, positions, bets), refreshed every 5 min
  WindowManager    — one per enabled asset, manages ContractWindow lifecycle
  ContractWindow   — one per 15-min time slot, owns phase transitions + order execution

Scheduler jobs (all on one shared AsyncIOScheduler):
  _tick              CronTrigger(second="25,55") — refresh candles, tick all windows
  _reload_windows    CronTrigger(minute="*/15")  — discover newly-opened windows
  _refresh_state     IntervalTrigger(seconds=300)— refresh balance/positions from Kalshi

The strategy no longer polls every 30s or checks timestamps in a loop.
Each ContractWindow is scheduled to its exact lifecycle moments.

Environment variables required:
  KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY
  SUPABASE_URL, SUPABASE_SERVICE_KEY
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (optional)
"""
import asyncio
import logging
from typing import Any, Dict

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv

from ..base_strategy import TradingStrategy
from ..registry import StrategyRegistry
from ..telegram_notifier import TelegramNotifier
from .candle_cache import CandleCache
from .config import KalshiCryptoConfig
from .kalshi_crypto_client import KalshiCryptoClient
from .shared_state import SharedState
from .supabase_logger import SupabaseLogger
from .window_manager import WindowManager

logger = logging.getLogger(__name__)

load_dotenv()


class KalshiCryptoStrategy(TradingStrategy):
    def get_name(self) -> str:
        return "kalshi-crypto"

    def get_type(self) -> str:
        return "scheduled"

    async def initialize(self):
        self.config = KalshiCryptoConfig.load()

        if not self.config.api_key_id or not self.config.private_key:
            raise ValueError("KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY are required")
        if not self.config.supabase_url or not self.config.supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
        if not self.config.assets:
            raise ValueError("No assets configured — check kalshi_crypto/config.yml")

        self._client = KalshiCryptoClient(
            self.config.api_key_id,
            self.config.private_key,
            dry_run=self.config.dry_run,
        )
        self._db = SupabaseLogger(self.config.supabase_url, self.config.supabase_key)
        self._telegram = TelegramNotifier(
            self.config.telegram_token, self.config.telegram_chat_id
        )
        self._scheduler = AsyncIOScheduler()

        self._shared_state = SharedState()
        self._candle_cache = CandleCache(client=self._client)
        self._asset_ids = [a.id for a in self.config.assets]

        self._managers: list[WindowManager] = [
            WindowManager(
                asset_cfg=a,
                client=self._client,
                db=self._db,
                telegram=self._telegram,
                candle_cache=self._candle_cache,
                shared_state=self._shared_state,
                scheduler=self._scheduler,
            )
            for a in self.config.assets
        ]

        logger.info(
            f"KalshiCrypto initialized | assets={self._asset_ids} | "
            f"dry_run={self.config.dry_run}"
        )

    def is_ready(self) -> bool:
        return hasattr(self, "_client") and self._client is not None

    async def start(self):
        if not self.is_ready():
            raise RuntimeError("Strategy not initialized — call initialize() first")

        # Bootstrap: load account state and initial candles before the first tick
        await self._shared_state.load(self._client, self._db)
        await self._candle_cache.refresh(self._asset_ids)

        # Discover and register all currently-open windows
        for manager in self._managers:
            await manager.reload_windows()

        # Job 1: price refresh + window ticks at :25 and :55 each minute
        self._scheduler.add_job(
            self._tick,
            CronTrigger(second="25,55"),
            id="kalshi_crypto_tick",
            name="Kalshi Crypto tick",
        )
        # Job 2: reload market list every 15 min to catch newly-opened windows
        self._scheduler.add_job(
            self._reload_windows,
            CronTrigger(minute="*/15", second=5),
            id="kalshi_crypto_reload",
            name="Kalshi Crypto window reload",
        )
        # Job 3: reconcile account state (balance, positions, bets) every 5 min
        self._scheduler.add_job(
            self._refresh_state,
            IntervalTrigger(seconds=300),
            id="kalshi_crypto_state",
            name="Kalshi Crypto state refresh",
        )

        self._scheduler.start()
        self.is_running = True

        logger.info(
            f"KalshiCrypto started | {len(self._managers)} asset(s) | "
            f"ticks at :25s/:55s | state refresh every 5 min"
        )
        try:
            while self.is_running:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            logger.info("KalshiCrypto strategy cancelled")

    async def stop(self):
        self.is_running = False
        if hasattr(self, "_scheduler"):
            self._scheduler.shutdown(wait=False)
        if hasattr(self, "_client"):
            await self._client.close()
        logger.info(f"KalshiCrypto stopped | stats={self.get_stats()}")

    def get_stats(self) -> Dict[str, Any]:
        return {
            "strategy": self.get_name(),
            "dry_run": self.config.dry_run,
            "managers": [m.get_stats() for m in self._managers]
            if hasattr(self, "_managers")
            else [],
        }

    # ── Scheduler job targets ─────────────────────────────────────────────────

    async def _tick(self) -> None:
        """
        Fires at :25 and :55 each minute.
        1. Refresh candle cache (concurrent fetch for all assets)
        2. Tick every WindowManager → drives ContractWindow phase transitions
        """
        await self._candle_cache.refresh(self._asset_ids)
        for manager in self._managers:
            try:
                await manager.tick()
            except Exception as e:
                logger.error(f"Manager tick error ({manager._cfg.id}): {e}", exc_info=True)

    async def _reload_windows(self) -> None:
        """Fires every 15 min. Discovers newly-opened windows."""
        for manager in self._managers:
            try:
                await manager.reload_windows()
            except Exception as e:
                logger.error(
                    f"Window reload error ({manager._cfg.id}): {e}", exc_info=True
                )

    async def _refresh_state(self) -> None:
        """Fires every 5 min. Reconciles account state from Kalshi + Supabase."""
        await self._shared_state.refresh(self._client, self._db)


StrategyRegistry.register("kalshi-crypto", KalshiCryptoStrategy)
