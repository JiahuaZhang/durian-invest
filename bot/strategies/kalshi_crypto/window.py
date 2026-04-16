"""
ContractWindow — manages one 15-minute time slot for one asset.

Lifecycle phases:
  PENDING      — before open_time, tick() is a no-op
  MM_WINDOW    — first 60s: Market Maker evaluated each tick
  TRADING      — 60s → (close_time - min_minutes_remaining): scalp + reversal
  WINDING_DOWN — too close to close for scalp, reversal can still enter
  RESOLVING    — DateTrigger fired, waiting for settlement data
  DONE         — fully resolved, WindowManager prunes this instance

tick() is called at :25 and :55 each minute by WindowManager.
_resolve() fires via a one-shot DateTrigger at close_time + 35s.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from enum import Enum, auto
from typing import Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger

from .config import AssetConfig
from .engine import (
    count_open_reversal_bets,
    evaluate_market_maker,
    evaluate_reversal,
    evaluate_scalp,
    has_open_position,
    kelly_contracts,
)
from .models import CryptoBet, CryptoResolution, CryptoSignal
from .notifier import format_execution, format_signal
from .supabase_logger import SupabaseLogger

logger = logging.getLogger(__name__)


class WindowPhase(Enum):
    PENDING      = auto()   # before open_time
    MM_WINDOW    = auto()   # first 60s — Market Maker
    TRADING      = auto()   # scalp + reversal
    WINDING_DOWN = auto()   # too close for scalp; reversal still runs
    RESOLVING    = auto()   # post-close, DateTrigger fired
    DONE         = auto()   # complete


class ContractWindow:
    """
    One 15-min window for one asset. All markets that share the same close_time
    are bundled into this single instance.
    """

    def __init__(
        self,
        asset_id: str,
        asset_cfg: AssetConfig,
        close_time: datetime,
        markets: list[dict],
        shared_state,          # SharedState
        candle_cache,          # CandleCache
        client,                # KalshiCryptoClient
        db: SupabaseLogger,
        telegram,              # TelegramNotifier
        scheduler: AsyncIOScheduler,
        on_resolved: Callable[["CryptoResolution"], Awaitable[None]],
    ):
        self.asset_id = asset_id
        self.close_time = close_time
        self.open_time = close_time - timedelta(minutes=15)
        self.markets = markets

        self._cfg = asset_cfg
        self._state = shared_state
        self._cache = candle_cache
        self._client = client
        self._db = db
        self._telegram = telegram
        self._scheduler = scheduler
        self._on_resolved = on_resolved

        self.phase = WindowPhase.PENDING
        self._mm_attempted: set[str] = set()
        self._resolution_job_id = f"resolve_{asset_id}_{close_time.strftime('%Y%m%dT%H%M')}"

        # Register resolution DateTrigger immediately on creation
        self._schedule_resolution()

    @property
    def window_key(self) -> str:
        return self.close_time.strftime("%Y%m%dT%H%M")

    def _schedule_resolution(self) -> None:
        """Register a one-shot DateTrigger at close_time + 35s."""
        run_at = self.close_time + timedelta(seconds=35)
        self._scheduler.add_job(
            self._resolve,
            DateTrigger(run_date=run_at),
            id=self._resolution_job_id,
            name=f"[{self.asset_id.upper()}] Resolve {self.window_key}",
            replace_existing=True,
            misfire_grace_time=120,
        )

    def _compute_phase(self) -> WindowPhase:
        now = datetime.now(timezone.utc)
        if now < self.open_time:
            return WindowPhase.PENDING
        age_secs = (now - self.open_time).total_seconds()
        mins_remaining = (self.close_time - now).total_seconds() / 60.0
        if age_secs <= self._cfg.mm.window_seconds:
            return WindowPhase.MM_WINDOW
        if mins_remaining >= self._cfg.scalp.min_minutes_remaining:
            return WindowPhase.TRADING
        if mins_remaining > 0:
            return WindowPhase.WINDING_DOWN
        return WindowPhase.RESOLVING

    async def tick(self) -> None:
        """
        Called at :25 and :55 each minute. Evaluates the appropriate strategy
        for the current phase. DONE and RESOLVING phases are no-ops.
        """
        if self.phase in (WindowPhase.DONE, WindowPhase.RESOLVING):
            return

        self.phase = self._compute_phase()

        if self.phase == WindowPhase.PENDING:
            return

        if self.phase == WindowPhase.MM_WINDOW:
            await self._evaluate_mm()
            return

        # TRADING or WINDING_DOWN — scalp + reversal
        pw = self._cache.get(self.asset_id)
        if pw is None:
            logger.warning(
                f"[{self.asset_id.upper()}] No candle data for window {self.window_key} — skipping"
            )
            return
        await self._evaluate_scalp_reversal(pw)

    # ── Strategy evaluators ───────────────────────────────────────────────────

    async def _evaluate_mm(self) -> None:
        for market in self.markets:
            ticker = market.get("ticker", "")
            if not ticker or ticker in self._mm_attempted:
                continue
            if has_open_position(self._state.open_positions, ticker):
                continue

            sig = evaluate_market_maker(market, self.asset_id, self._cfg.mm)
            if sig.action != "BUY_BOTH":
                continue

            self._mm_attempted.add(ticker)
            await self._execute_market_maker(sig)

    async def _evaluate_scalp_reversal(self, price_window) -> None:
        open_rev = count_open_reversal_bets(self._state.open_bets, self.asset_id)

        for market in self.markets:
            ticker = market.get("ticker", "")
            if not ticker:
                continue

            already_in = has_open_position(self._state.open_positions, ticker)

            # Scalp — engine checks min_minutes_remaining internally
            if not already_in:
                scalp_sig = evaluate_scalp(
                    market, self.asset_id, price_window, self._cfg.scalp
                )
                if scalp_sig.action == "BUY_YES":
                    await self._execute_signal(
                        scalp_sig,
                        kelly_fraction=self._cfg.scalp.kelly_fraction,
                        max_bet_usd=self._cfg.scalp.max_bet_usd,
                    )
                    continue  # already entered this market — skip reversal too

            # Reversal — vol-gated, fixed size
            if open_rev < self._cfg.reversal.max_concurrent and not already_in:
                rev_sig = evaluate_reversal(
                    market, self.asset_id, price_window, self._cfg.reversal
                )
                if rev_sig.action == "BUY_YES":
                    await self._execute_signal(
                        rev_sig,
                        kelly_fraction=None,
                        max_bet_usd=self._cfg.reversal.size_usd,
                        fixed_contracts=True,
                    )
                    open_rev += 1  # respect cap within this tick

    # ── Order execution ───────────────────────────────────────────────────────

    async def _execute_signal(
        self,
        signal: CryptoSignal,
        kelly_fraction,
        max_bet_usd: float,
        fixed_contracts: bool = False,
    ) -> None:
        await self._telegram.send(format_signal(signal))
        await self._db.log_signal(signal)

        if fixed_contracts:
            n = max(int(max_bet_usd / max(signal.entry_price, 0.01)), 1)
        else:
            n = kelly_contracts(
                p=0.65,
                price=signal.entry_price,
                bankroll=self._state.balance,
                max_bet_usd=max_bet_usd,
                kelly_fraction=kelly_fraction,
            )
        if n <= 0:
            return

        order = await self._client.place_order(
            signal.market_ticker, "yes", n, int(signal.entry_price * 100)
        )
        if not order:
            return

        bet = CryptoBet(
            signal_id=signal.id,
            asset_id=self.asset_id,
            strategy=signal.strategy,
            market_ticker=signal.market_ticker,
            side="yes",
            contracts=n,
            price_per_contract=signal.entry_price,
            total_cost=round(signal.entry_price * n, 2),
            kalshi_order_id=order.get("order_id", ""),
            status=order.get("status", "open"),
        )
        await self._db.log_bet(bet)
        await self._telegram.send(format_execution(bet, self._client.dry_run))

        self._state.add_position(bet.market_ticker)
        self._state.add_bet(_bet_as_dict(bet))
        self._state.deduct_balance(bet.total_cost)

    async def _execute_market_maker(self, signal: CryptoSignal) -> None:
        mm_cfg = self._cfg.mm
        if (mm_cfg.size_usd * 2) > self._state.balance * mm_cfg.max_bankroll_pct:
            logger.info(
                f"[{self.asset_id.upper()}] MM bankroll cap — skipping {signal.market_ticker}"
            )
            return

        await self._telegram.send(format_signal(signal))
        await self._db.log_signal(signal)

        yes_price = signal.entry_price
        no_price = 1.0 - yes_price
        n = max(int(mm_cfg.size_usd / yes_price), 1)

        yes_order = await self._client.place_order(
            signal.market_ticker, "yes", n, int(yes_price * 100)
        )
        no_order = await self._client.place_order(
            signal.market_ticker, "no", n, int(no_price * 100)
        )

        for order, side, price in [
            (yes_order, "yes", yes_price),
            (no_order,  "no",  no_price),
        ]:
            if not order:
                continue
            bet = CryptoBet(
                signal_id=signal.id,
                asset_id=self.asset_id,
                strategy="market_maker",
                market_ticker=signal.market_ticker,
                side=side,
                contracts=n,
                price_per_contract=price,
                total_cost=round(price * n, 2),
                kalshi_order_id=order.get("order_id", ""),
                status=order.get("status", "open"),
            )
            await self._db.log_bet(bet)
            await self._telegram.send(format_execution(bet, self._client.dry_run))
            self._state.add_bet(_bet_as_dict(bet))
            self._state.deduct_balance(bet.total_cost)

            oid = order.get("order_id", "")
            if oid and oid != "dry-run":
                asyncio.create_task(self._cancel_after(oid, mm_cfg.cancel_after_seconds))

        self._state.add_position(signal.market_ticker)

    async def _cancel_after(self, order_id: str, delay: float) -> None:
        await asyncio.sleep(delay)
        if await self._client.cancel_order(order_id):
            await self._db.update_bet_status(order_id, "cancelled")
            self._state.cancel_bet_by_order(order_id)
            logger.info(f"Cancelled unfilled MM order {order_id}")

    # ── Resolution ────────────────────────────────────────────────────────────

    async def _resolve(self) -> None:
        """
        DateTrigger callback at close_time + 35s.
        Fetches positions directly from Kalshi (one fresh call per window),
        matches settled positions to open bets, fires on_resolved for each.
        """
        self.phase = WindowPhase.RESOLVING
        logger.info(f"[{self.asset_id.upper()}] Resolving window {self.window_key}")

        try:
            all_positions = await self._client.get_open_positions()
            window_tickers = {m.get("ticker", "") for m in self.markets}

            settled = [
                p for p in all_positions
                if p.get("market_ticker", "") in window_tickers
                and p.get("resting_orders_count", 1) == 0
            ]

            for pos in settled:
                ticker = pos.get("market_ticker", "")
                pnl_usd = pos.get("realized_pnl", 0) / 100.0  # cents → USD

                for bet_row in [b for b in self._state.open_bets if b.get("market_ticker") == ticker]:
                    won = pnl_usd > 0
                    resolution = CryptoResolution(
                        bet_id=bet_row["id"],
                        market_ticker=ticker,
                        asset_id=self.asset_id,
                        strategy=bet_row.get("strategy", ""),
                        outcome="yes" if won else "no",
                        won=won,
                        payout=bet_row.get("total_cost", 0) + pnl_usd,
                        profit_loss=pnl_usd,
                    )
                    await self._db.log_resolution(resolution)
                    await self._db.update_bet_status(bet_row["id"], "resolved", pnl=pnl_usd)
                    self._state.remove_bet(bet_row["id"])
                    await self._on_resolved(resolution)
        except Exception as e:
            logger.error(f"Resolution failed for {self.window_key}: {e}", exc_info=True)
        finally:
            self.phase = WindowPhase.DONE


def _bet_as_dict(bet: CryptoBet) -> dict:
    return {
        "id": bet.id,
        "asset_id": bet.asset_id,
        "strategy": bet.strategy,
        "market_ticker": bet.market_ticker,
        "side": bet.side,
        "contracts": bet.contracts,
        "total_cost": bet.total_cost,
        "kalshi_order_id": bet.kalshi_order_id,
        "status": bet.status,
    }
