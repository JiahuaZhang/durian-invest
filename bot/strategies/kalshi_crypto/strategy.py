"""
Kalshi BTC 15-min scalp bot.

Strategy: follow the conviction trend — when either YES or NO has an ask in the
85-92¢ zone, the market has 85-92% confidence it will resolve that way.  Buy
that side at market ask, place a resting limit sell at 97¢, and exit via stop
loss at 88¢ if the bid turns against us.

Required env vars:
  use-demo: false  →  KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY       (production)
  use-demo: true   →  KALSHI_DEMO_KEY_ID + KALSHI_DEMO_PRIVATE_KEY (demo.kalshi.co)

Optional:
  SUPABASE_URL, SUPABASE_SERVICE_KEY  — bet logging
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — notifications
"""
import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from strategies.base_strategy import TradingStrategy
from strategies.telegram_notifier import TelegramNotifier
from strategies.kalshi_crypto.config import BtcScalpConfig, CryptoJobConfig
from strategies.kalshi_crypto.crypto15m_job import Crypto15mJob
from strategies.kalshi_crypto.kalshi_crypto_client import KalshiCryptoClient
from strategies.kalshi_crypto.supabase_logger import SupabaseLogger

logger = logging.getLogger(__name__)


class KalshiCryptoStrategy(TradingStrategy):
    def __init__(self):
        super().__init__()
        self.cfg = BtcScalpConfig.load()

        if not self.cfg.api_key_id or not self.cfg.private_key:
            env_hint = (
                "KALSHI_DEMO_KEY_ID / KALSHI_DEMO_PRIVATE_KEY"
                if self.cfg.use_demo
                else "KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY"
            )
            raise ValueError(f"{env_hint} must be set in .env")

        self._client = KalshiCryptoClient(
            self.cfg.api_key_id,
            self.cfg.private_key,
            subaccount=self.cfg.subaccount,
            use_demo=self.cfg.use_demo,
        )

        self._db: SupabaseLogger | None = None
        if self.cfg.supabase_url and self.cfg.supabase_key:
            self._db = SupabaseLogger(self.cfg.supabase_url, self.cfg.supabase_key)
        else:
            logger.warning("Supabase not configured — bet logging disabled")

        self._telegram = TelegramNotifier(self.cfg.telegram_token, self.cfg.telegram_chat_id)
        self._scheduler = AsyncIOScheduler()

        job_cfg = CryptoJobConfig(
            series=self.cfg.series,
            entry_dollars=self.cfg.entry_dollars,
            target_dollars=self.cfg.target_dollars,
            stop_loss_dollars=self.cfg.stop_loss_dollars,
            count=self.cfg.count,
        )
        self._jobs: list[Crypto15mJob] = [
            Crypto15mJob(job_cfg, self._client, self._db, self._telegram, self.cfg.use_demo),
        ]

        env_tag = "[DEMO]" if self.cfg.use_demo else "[LIVE]"
        logger.info(
            f"KalshiCrypto initialized {env_tag} | "
            f"series={self.cfg.series} | "
            f"entry {self.cfg.entry_dollars}$ → "
            f"sell@{self.cfg.target_dollars}$ stop@{self.cfg.stop_loss_dollars}$ | "
            f"count={self.cfg.count} | "
            f"schedule=:00/:15/:30/:45"
        )

    def get_name(self) -> str:
        return "kalshi-crypto"

    def get_type(self) -> str:
        return "scheduled"

    async def start(self):
        for job in self._jobs:
            self._scheduler.add_job(
                job.run,
                CronTrigger(minute="0,15,30,45"),
                id=f"scalp_{job.cfg.series}",
                name=f"{job.cfg.series} 15m scalp",
            )
        self._scheduler.start()
        self.is_running = True
        logger.info(
            f"KalshiCrypto started — {len(self._jobs)} job(s) scheduled at :00/:15/:30/:45"
        )

        try:
            while self.is_running:
                await asyncio.sleep(86400)
        except asyncio.CancelledError:
            pass

    async def stop(self):
        self.is_running = False
        if hasattr(self, "_scheduler"):
            self._scheduler.shutdown(wait=False)
        if hasattr(self, "_client"):
            await self._client.close()

    def get_stats(self) -> dict:
        return {
            "strategy": self.get_name(),
            "use_demo": self.cfg.use_demo,
            "jobs": [
                {"series": job.cfg.series, "active_tickers": list(job._active_trades.keys())}
                for job in self._jobs
            ],
        }


    def is_enabled(self) -> bool:
        return self.cfg.enabled


if __name__ == "__main__":
    async def _run():
        s = KalshiCryptoStrategy()
        await s.start()

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        print("\nStopped")
