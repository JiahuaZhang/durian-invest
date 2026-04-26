"""
Kalshi BTC 15-min orderbook imbalance strategy.

Streams the order book via WebSocket and measures dollar-weighted imbalance
to follow the dominant side when conviction is strong and spreads are tight.

Required env vars:
  use-demo: false  →  KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY       (production)
  use-demo: true   →  KALSHI_DEMO_KEY_ID + KALSHI_DEMO_PRIVATE_KEY (demo.kalshi.co)

Optional:
  SUPABASE_URL, SUPABASE_SERVICE_KEY  — bet logging
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — notifications
"""
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from strategies.base_strategy import TradingStrategy
from strategies.telegram_notifier import TelegramNotifier
from strategies.kalshi_crypto.config import BtcScalpConfig, CryptoJobConfig
from strategies.kalshi_crypto.crypto15m_job import Crypto15mJob
from strategies.kalshi_client import KalshiClient
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

        self._client = KalshiClient(
            api_key_id=self.cfg.api_key_id,
            private_key_pem=self.cfg.private_key,
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
            count=self.cfg.count,
            spread=self.cfg.spread,
            imbalance=self.cfg.imbalance,
        )
        self._job: Crypto15mJob = Crypto15mJob(job_cfg, self._client, self._db, self._telegram, self.cfg.use_demo)

        env_tag = "[DEMO]" if self.cfg.use_demo else "[LIVE]"
        logger.info(
            f"KalshiCrypto initialized {env_tag} | "
            f"series={self.cfg.series} | "
            f"spread<={self.cfg.spread} imbalance>={self.cfg.imbalance} | "
            f"count={self.cfg.count}"
        )

    def get_name(self) -> str:
        return "kalshi-crypto"

    def get_type(self) -> str:
        return "scheduled"

    async def start(self):
        await self._job.start()

    async def stop(self):
        # await self._job.stop()
        pass

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