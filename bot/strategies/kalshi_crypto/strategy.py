"""
Kalshi BTC 15-min scalp bot.

Strategy: buy YES when ask ≤ 92¢, place limit sell at 97¢.
Scans Kalshi every 30 seconds. No external price feeds.

Required env vars:
  KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY
  SUPABASE_URL, SUPABASE_SERVICE_KEY
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
"""
import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv

from ..base_strategy import TradingStrategy
from ..registry import StrategyRegistry
from ..telegram_notifier import TelegramNotifier
from .config import BtcScalpConfig
from .kalshi_crypto_client import KalshiCryptoClient
from .market_state import compute_minutes_remaining
from .supabase_logger import SupabaseLogger

logger = logging.getLogger(__name__)

load_dotenv()


class KalshiCryptoStrategy(TradingStrategy):
    def get_name(self) -> str:
        return "kalshi-crypto"

    def get_type(self) -> str:
        return "scheduled"

    async def initialize(self):
        self.cfg = BtcScalpConfig.load()

        if not self.cfg.api_key_id or not self.cfg.private_key:
            raise ValueError("KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY must be set in .env")

        self._client = KalshiCryptoClient(
            self.cfg.api_key_id,
            self.cfg.private_key,
            dry_run=self.cfg.dry_run,
        )

        # Supabase is optional — if not configured, bet logging is skipped
        self._db: SupabaseLogger | None = None
        if self.cfg.supabase_url and self.cfg.supabase_key:
            self._db = SupabaseLogger(self.cfg.supabase_url, self.cfg.supabase_key)
        else:
            logger.warning("Supabase not configured — bet logging disabled")

        self._telegram = TelegramNotifier(self.cfg.telegram_token, self.cfg.telegram_chat_id)
        self._scheduler = AsyncIOScheduler()

        # In-memory set of tickers we've already entered this session
        # (cleared on restart; Kalshi positions are the source of truth)
        self._entered: set[str] = set()

        dry_tag = " [DRY RUN]" if self.cfg.dry_run else " [LIVE]"
        logger.info(
            f"KalshiCrypto initialized{dry_tag} | "
            f"series={self.cfg.series} | "
            f"entry≤{self.cfg.entry_cents}¢ → sell@{self.cfg.target_cents}¢ | "
            f"contracts={self.cfg.contracts} | "
            f"scan={self.cfg.scan_interval_seconds}s"
        )

    async def start(self):
        self._scheduler.add_job(
            self._scan,
            IntervalTrigger(seconds=self.cfg.scan_interval_seconds),
            id="btc_scalp_scan",
            name="BTC scalp scan",
        )
        self._scheduler.start()
        self.is_running = True
        logger.info(f"KalshiCrypto started — scanning {self.cfg.series} every {self.cfg.scan_interval_seconds}s")

        try:
            while self.is_running:
                await asyncio.sleep(60)
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
            "series": self.cfg.series,
            "dry_run": self.cfg.dry_run,
            "entered_this_session": len(self._entered),
        }

    # ── Core scan ─────────────────────────────────────────────────────────────

    async def _scan(self):
        """
        Runs every 30s. Fetches open BTC markets and checks each for entry.
        Entry condition: yes_ask ≤ entry_cents AND mins_remaining ≥ min_mins_left
        AND not already in this market.
        """
        markets = await self._client.get_markets(self.cfg.series)
        if not markets:
            logger.debug(f"No open markets for {self.cfg.series}")
            return

        # Refresh entered set from actual Kalshi positions once per scan
        positions = await self._client.get_open_positions()
        positioned = {p.get("market_ticker") for p in positions}

        for market in markets:
            ticker = market.get("ticker", "")
            yes_ask = market.get("yes_ask", 100)   # Kalshi returns cents (0–100)

            if not ticker:
                continue
            if ticker in positioned or ticker in self._entered:
                continue

            mins_left = compute_minutes_remaining(market)

            logger.debug(
                f"{ticker}  YES ask={yes_ask}¢  {mins_left:.1f}m left"
            )

            if yes_ask > self.cfg.entry_cents:
                continue
            if mins_left < self.cfg.min_mins_left:
                continue

            # ── Entry condition met ───────────────────────────────────────────
            await self._enter(ticker, yes_ask, mins_left)
            self._entered.add(ticker)

    async def _enter(self, ticker: str, yes_ask: int, mins_left: float):
        """Place buy + limit sell orders and notify."""
        dry_tag = "  <i>[DRY RUN]</i>" if self.cfg.dry_run else ""
        logger.info(
            f"[BTC SCALP] {ticker}  YES @ {yes_ask}¢  {mins_left:.1f}m left — entering"
        )

        # Telegram: signal alert
        await self._telegram.send(
            f"<b>[BTC] Scalp Signal{dry_tag}</b>\n"
            f"Market: {ticker}  ({mins_left:.1f}m left)\n"
            f"Entry: YES @ <b>{yes_ask}¢</b>  →  target <b>{self.cfg.target_cents}¢</b>\n"
            f"Contracts: {self.cfg.contracts}  |  cost ~${yes_ask * self.cfg.contracts / 100:.2f}"
        )

        # Place limit BUY
        buy = await self._client.place_order(
            ticker, "yes", self.cfg.contracts, yes_ask, action="buy"
        )
        if not buy:
            logger.error(f"Buy order failed for {ticker}")
            return

        buy_id = buy.get("order_id", "")

        # Place limit SELL at target (resting order, auto-exits at profit)
        sell = await self._client.place_order(
            ticker, "yes", self.cfg.contracts, self.cfg.target_cents, action="sell"
        )
        sell_id = sell.get("order_id", "") if sell else "failed"

        logger.info(
            f"[BTC SCALP] Orders placed — buy={buy_id}  sell={sell_id}"
        )

        # Telegram: execution confirmation
        await self._telegram.send(
            f"<b>[BTC] Orders Placed{dry_tag}</b>\n"
            f"BUY  YES ×{self.cfg.contracts} @ {yes_ask}¢  →  {buy_id}\n"
            f"SELL YES ×{self.cfg.contracts} @ {self.cfg.target_cents}¢  →  {sell_id}"
        )

        # Supabase: log the bet (if configured)
        if self._db:
            from .models import CryptoBet
            bet = CryptoBet(
                asset_id="btc",
                strategy="scalp",
                market_ticker=ticker,
                side="yes",
                contracts=self.cfg.contracts,
                price_per_contract=yes_ask / 100.0,
                total_cost=round(yes_ask * self.cfg.contracts / 100.0, 2),
                kalshi_order_id=buy_id,
                status="open",
            )
            await self._db.log_bet(bet)


StrategyRegistry.register("kalshi-crypto", KalshiCryptoStrategy)
