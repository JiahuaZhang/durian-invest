"""
Kalshi Crypto Strategy
----------------------
Runs three sub-strategies (Scalp, Reversal, Market Maker) simultaneously
against Kalshi's 15-min crypto prediction markets.

Polling: every 30 seconds via APScheduler IntervalTrigger.
Assets:  BTC, ETH, SOL, XRP, DOGE, BNB, AVAX, LTC (configurable in config.yml).

Environment variables required:
  KALSHI_API_KEY_ID      — from kalshi.com → Settings → API
  KALSHI_PRIVATE_KEY     — RSA private key (multiline, in double quotes in .env)
  SUPABASE_URL           — from common.yml / .env
  SUPABASE_SERVICE_KEY   — from common.yml / .env
  TELEGRAM_BOT_TOKEN     — optional, from common.yml / .env
  TELEGRAM_CHAT_ID       — optional, from common.yml / .env
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv

from ..base_strategy import TradingStrategy
from ..registry import StrategyRegistry
from ..telegram_notifier import TelegramNotifier
from .config import AssetConfig, KalshiCryptoConfig
from .engine import (
    count_open_reversal_bets,
    evaluate_market_maker,
    evaluate_reversal,
    evaluate_scalp,
    has_open_position,
    kelly_contracts,
)
from .kalshi_crypto_client import KalshiCryptoClient
from .market_state import compute_candle_age
from .models import CryptoBet, CryptoResolution
from .notifier import format_execution, format_resolution, format_signal
from .supabase_logger import SupabaseLogger

logger = logging.getLogger(__name__)

load_dotenv()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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

        # In-memory daily P&L (reset on process restart)
        self._daily_pnl: float = 0.0
        self._daily_wins: int = 0
        self._daily_losses: int = 0
        self._stats: Dict[str, Any] = {
            "scans": 0, "signals": 0, "bets": 0, "skipped": 0
        }

        asset_ids = [a.id for a in self.config.assets]
        logger.info(
            f"KalshiCrypto initialized | assets={asset_ids} | "
            f"dry_run={self.config.dry_run} | interval={self.config.scan_interval_seconds}s"
        )

    def is_ready(self) -> bool:
        return hasattr(self, '_client') and self._client is not None

    async def start(self):
        if not self.is_ready():
            raise RuntimeError("Strategy not initialized — call initialize() first")

        self._scheduler.add_job(
            self._scan,
            IntervalTrigger(seconds=self.config.scan_interval_seconds),
            id="kalshi_crypto_scan",
            name="Kalshi Crypto scan",
        )
        self._scheduler.start()
        self.is_running = True

        logger.info(
            f"KalshiCrypto started — scanning every {self.config.scan_interval_seconds}s "
            f"across {len(self.config.assets)} asset(s)"
        )
        try:
            while self.is_running:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            logger.info("KalshiCrypto strategy cancelled")

    async def stop(self):
        self.is_running = False
        if hasattr(self, '_scheduler'):
            self._scheduler.shutdown(wait=False)
        if hasattr(self, '_client'):
            await self._client.close()
        logger.info(f"KalshiCrypto stopped | stats={self._stats}")

    def get_stats(self) -> Dict[str, Any]:
        return {
            "strategy": self.get_name(),
            "assets": [a.id for a in self.config.assets] if self.config.assets else [],
            "dry_run": self.config.dry_run,
            **self._stats,
            "daily_pnl": self._daily_pnl,
            "daily_wins": self._daily_wins,
            "daily_losses": self._daily_losses,
        }

    # ── Main scan loop ────────────────────────────────────────────────────────

    async def _scan(self):
        self._stats["scans"] += 1
        balance = await self._client.get_balance()
        open_positions = await self._client.get_open_positions()
        open_bets = await self._db.get_open_bets()

        for asset_cfg in self.config.assets:
            try:
                await self._scan_asset(asset_cfg, balance, open_positions, open_bets)
            except Exception as e:
                logger.error(f"Error scanning {asset_cfg.id}: {e}", exc_info=True)

        await self._check_resolutions(open_positions)

    async def _scan_asset(
        self,
        asset_cfg: AssetConfig,
        balance: float,
        open_positions: list[dict],
        open_bets: list[dict],
    ):
        markets = await self._client.get_markets(asset_cfg.series)
        if not markets:
            logger.debug(f"[{asset_cfg.id.upper()}] No open markets for {asset_cfg.series}")
            return

        price_window = await self._client.get_price_window(asset_cfg.id)
        if not price_window:
            logger.warning(
                f"[{asset_cfg.id.upper()}] Price feed unavailable — skipping this scan"
            )
            return

        logger.debug(
            f"[{asset_cfg.id.upper()}] {len(markets)} markets | "
            f"${price_window.current_price:,.2f} | vol={price_window.volatility_15m:.5f}"
        )

        for market in markets:
            ticker = market.get("ticker", "")
            if not ticker:
                continue

            age = compute_candle_age(market)

            # ── Strategy 3: Market Maker (first 60s of candle) ────────────────
            if age <= asset_cfg.mm.window_seconds:
                mm_sig = evaluate_market_maker(market, asset_cfg.id, asset_cfg.mm)
                if mm_sig.action == "BUY_BOTH" and not has_open_position(open_positions, ticker):
                    await self._execute_market_maker(mm_sig, balance, asset_cfg)

            # ── Strategy 1: Scalp (after first 60s) ──────────────────────────
            if age > 60:
                scalp_sig = evaluate_scalp(
                    market, asset_cfg.id, price_window, asset_cfg.scalp
                )
                self._stats["signals"] += 1
                if scalp_sig.action == "BUY_YES" and not has_open_position(
                    open_positions, ticker
                ):
                    await self._execute_signal(
                        scalp_sig, balance,
                        kelly_fraction=asset_cfg.scalp.kelly_fraction,
                        max_bet_usd=asset_cfg.scalp.max_bet_usd,
                    )
                else:
                    self._stats["skipped"] += 1

            # ── Strategy 2: Reversal (any time, low-vol gated) ───────────────
            open_rev = count_open_reversal_bets(open_bets, asset_cfg.id)
            if open_rev < asset_cfg.reversal.max_concurrent:
                rev_sig = evaluate_reversal(
                    market, asset_cfg.id, price_window, asset_cfg.reversal
                )
                self._stats["signals"] += 1
                if rev_sig.action == "BUY_YES" and not has_open_position(
                    open_positions, ticker
                ):
                    await self._execute_signal(
                        rev_sig, balance,
                        kelly_fraction=None,
                        max_bet_usd=asset_cfg.reversal.size_usd,
                        fixed_contracts=True,
                    )
                else:
                    self._stats["skipped"] += 1

    # ── Order execution ───────────────────────────────────────────────────────

    async def _execute_signal(
        self,
        signal,
        balance: float,
        kelly_fraction,
        max_bet_usd: float,
        fixed_contracts: bool = False,
    ):
        await self._telegram.send(format_signal(signal))
        await self._db.log_signal(signal)

        if fixed_contracts:
            # Reversal: fixed dollar amount, not Kelly
            n_contracts = max(int(max_bet_usd / max(signal.entry_price, 0.01)), 1)
        else:
            # Scalp: quarter-Kelly, conservative p estimate
            p_est = 0.65  # historical win rate for 92¢ scalp entries
            n_contracts = kelly_contracts(
                p=p_est,
                price=signal.entry_price,
                bankroll=balance,
                max_bet_usd=max_bet_usd,
                kelly_fraction=kelly_fraction,
            )

        if n_contracts <= 0:
            logger.info(f"Kelly returned 0 contracts for {signal.market_ticker} — skipping")
            return

        order = await self._client.place_order(
            signal.market_ticker, "yes", n_contracts, int(signal.entry_price * 100)
        )
        if not order:
            return

        bet = CryptoBet(
            signal_id=signal.id,
            asset_id=signal.asset_id,
            strategy=signal.strategy,
            market_ticker=signal.market_ticker,
            side="yes",
            contracts=n_contracts,
            price_per_contract=signal.entry_price,
            total_cost=round(signal.entry_price * n_contracts, 2),
            kalshi_order_id=order.get("order_id", ""),
            status=order.get("status", "open"),
        )
        await self._db.log_bet(bet)
        await self._telegram.send(format_execution(bet, self.config.dry_run))
        self._stats["bets"] += 1

    async def _execute_market_maker(
        self, signal, balance: float, asset_cfg: AssetConfig
    ):
        mm_cfg = asset_cfg.mm

        # Bankroll cap: 2 sides × size_usd must fit within max_bankroll_pct
        if (mm_cfg.size_usd * 2) > balance * mm_cfg.max_bankroll_pct:
            logger.info(
                f"[{asset_cfg.id.upper()}] MM bankroll cap reached — skipping "
                f"(need ${mm_cfg.size_usd * 2:.0f}, cap is "
                f"${balance * mm_cfg.max_bankroll_pct:.0f})"
            )
            return

        await self._telegram.send(format_signal(signal))
        await self._db.log_signal(signal)

        yes_price = signal.entry_price          # 0.49
        no_price  = 1.0 - yes_price            # 0.51 (complement)
        n_contracts = max(int(mm_cfg.size_usd / yes_price), 1)

        # Place YES limit order
        yes_order = await self._client.place_order(
            signal.market_ticker, "yes", n_contracts, int(yes_price * 100)
        )
        # Place NO limit order
        no_order = await self._client.place_order(
            signal.market_ticker, "no", n_contracts, int(no_price * 100)
        )

        for order, side, price in [
            (yes_order, "yes", yes_price),
            (no_order,  "no",  no_price),
        ]:
            if not order:
                continue
            bet = CryptoBet(
                signal_id=signal.id,
                asset_id=signal.asset_id,
                strategy="market_maker",
                market_ticker=signal.market_ticker,
                side=side,
                contracts=n_contracts,
                price_per_contract=price,
                total_cost=round(price * n_contracts, 2),
                kalshi_order_id=order.get("order_id", ""),
                status=order.get("status", "open"),
            )
            await self._db.log_bet(bet)
            await self._telegram.send(format_execution(bet, self.config.dry_run))
            self._stats["bets"] += 1

            # Schedule cancel of this resting order after the window expires
            oid = order.get("order_id", "")
            if oid and oid != "dry-run":
                asyncio.create_task(
                    self._cancel_after(oid, mm_cfg.cancel_after_seconds)
                )

    async def _cancel_after(self, order_id: str, delay: float):
        """Cancel a resting order after `delay` seconds (Market Maker cleanup)."""
        await asyncio.sleep(delay)
        cancelled = await self._client.cancel_order(order_id)
        if cancelled:
            logger.info(f"Cancelled unfilled MM order {order_id}")
            await self._db.update_bet_status(order_id, "cancelled")

    # ── Resolution tracking ───────────────────────────────────────────────────

    async def _check_resolutions(self, open_positions: list[dict]):
        """
        Settled positions have no resting orders.
        Cross-reference with open bets in DB, log P&L, send Telegram notification.
        """
        settled = [
            p for p in open_positions
            if p.get("resting_orders_count", 1) == 0
        ]
        if not settled:
            return

        open_bets = await self._db.get_open_bets()

        for pos in settled:
            ticker = pos.get("market_ticker", "")
            pnl_usd = pos.get("realized_pnl", 0) / 100.0  # cents → USD

            matching = [b for b in open_bets if b.get("market_ticker") == ticker]
            if not matching:
                continue

            for bet_row in matching:
                won = pnl_usd > 0
                resolution = CryptoResolution(
                    bet_id=bet_row["id"],
                    market_ticker=ticker,
                    asset_id=bet_row.get("asset_id", ""),
                    strategy=bet_row.get("strategy", ""),
                    outcome="yes" if won else "no",
                    won=won,
                    payout=bet_row.get("total_cost", 0) + pnl_usd,
                    profit_loss=pnl_usd,
                )
                await self._db.log_resolution(resolution)
                await self._db.update_bet_status(bet_row["id"], "resolved", pnl=pnl_usd)

                self._daily_pnl += pnl_usd
                if won:
                    self._daily_wins += 1
                else:
                    self._daily_losses += 1

                await self._telegram.send(
                    format_resolution(
                        resolution,
                        daily_pnl=self._daily_pnl,
                        daily_wins=self._daily_wins,
                        daily_losses=self._daily_losses,
                    )
                )


StrategyRegistry.register('kalshi-crypto', KalshiCryptoStrategy)
