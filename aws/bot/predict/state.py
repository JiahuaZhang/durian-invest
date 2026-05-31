"""
Per-market state for predict.fun — mirror of polymarket_state.py.

Holds open-price, latest comparator prices (Binance/Coinbase, optional), the
on-platform oracle price from predict's own ``assetPriceUpdate`` WS stream,
and a PredictOrderBook driven by ``predictOrderbook`` snapshots.

When prices come in, ``update_price`` evaluates the existing divergence +
imbalance signal (signals/divergence.py).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Literal

import httpx

from ..config import BotConfig
from ..signals.divergence import LatencyAnalysis, get_combined_latency_signal
from .order_book import PredictOrderBook
from .client import PredictClient


logger = logging.getLogger(__name__)

PredictPriceSource = Literal["binance", "coinbase", "chainlink"]


class PredictStatus(Enum):
    INIT = "init"
    READY = "ready"
    BUYING = "buying"
    HOLDING = "holding"
    SELLING = "selling"
    WATCHING = "watching"
    STOPPED = "stopped"

@dataclass
class OrderRecord:
    """Timestamps and identifiers for one leg of a trade."""
    signal: LatencyAnalysis
    start: float                   # time.time() when order submitted
    filled: float | None = None    # time.time() when fill confirmed
    order_hash: str | None = None
    order_id: str | None = None


@dataclass
class Trade:
    """Full lifecycle of a single position: entry + optional exit."""
    side: str                      # "up" or "down"
    outcome_name: str              # "Up" or "Down"
    entry_price: float             # price paid per share at entry
    enter: OrderRecord
    exit: OrderRecord | None = None
    exit_price: float | None = None  # price received per share at exit
    pnl: float | None = None        # exit_price - entry_price (per share)


# Fill-check delays: check immediately, then after 2s, then after 4s.
_FILL_CHECK_DELAYS = [0, 2, 4]

class PredictState:
    """Single-market state for predict.fun, structured like PolymarketState."""

    def __init__(
        self,
        cfg: BotConfig,
        client: PredictClient,
        market: dict[str, Any],
    ):
        self.cfg = cfg
        self.client = client
        self.market = market

        self.start_price = market.get("variantData").get("startPrice")
        self.status = PredictStatus.INIT
        self.trades: list[Trade] = []
        self._order_task: asyncio.Task | None = None

        self.orderbook = PredictOrderBook(market_id=self.market_id, side="Yes")
        self.binance_price: float = 0.0
        self.coinbase_price: float = 0.0
        self.chainlink_price: float = 0.0
        self.last_price_update: dict[PredictPriceSource, float] = {
            "binance": 0.0,
            "coinbase": 0.0,
            "chainlink": 0.0,
        }

        self.save_log = cfg.use_proxy
        self.log_path = Path(__file__).resolve().parent.parent / "logs" / f"{self.slug}.jsonl"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def market_id(self) -> int:
        return int(self.market["id"])

    @property
    def slug(self) -> str:
        return self.market.get("categorySlug")

    @property
    def yes_token_id(self) -> str:
        for o in self.market.get("outcomes", []):
            if o.get("name") == "Up":
                return o.get("onChainId")
        return ""

    @property
    def no_token_id(self) -> str:
        for o in self.market.get("outcomes", []):
            if o.get("name") == "Down":
                return o.get("onChainId")
        return ""

    @property
    def price_feed_provider(self) -> str | None:
        return self.market.get("variantData", {}).get("priceFeedProvider")

    def is_ready(self) -> bool:
        """Return true if all prices are ready."""
        return self.start_price > 0 and self.binance_price > 0 and self.coinbase_price > 0 and self.chainlink_price > 0 and self.orderbook.is_ready()

    def apply_message(self, message: dict[str, Any]) -> bool:
        """Route an incoming predict.fun WS frame to the orderbook"""
        topic = message.get("topic")
        if topic != f"predictOrderbook/{self.market_id}":
            return False    
        
        before = self.orderbook.last_update
        self.orderbook.apply(message)
        return self.orderbook.last_update != before
    
    def update(self, source: str, args: any) -> None:
        now = time.monotonic()
        match source:
            case 'start price':
                self.start_price = args
            case 'orderbook':
                self.apply_message(args)
            case 'binance':
                self.binance_price = args
                self.last_price_update['binance'] = now
            case 'coinbase':
                self.coinbase_price = args
                self.last_price_update['coinbase'] = now
            case 'chainlink':
                self.chainlink_price = args
                self.last_price_update['chainlink'] = now
            case _:
                raise ValueError(f"Unknown source: {source!r}")

        match self.status:
            case PredictStatus.INIT:
                if self.is_ready():
                    self.status = PredictStatus.READY
            case PredictStatus.STOPPED:
                return
            case PredictStatus.READY:
                analysis = self._evaluate_signal(source)
                self._check_entry_signal(analysis)
            case PredictStatus.HOLDING:
                analysis = self._evaluate_signal(source)
                self._check_exit_signal(analysis)
            case PredictStatus.WATCHING:
                analysis = self._evaluate_signal(source)
                self._log_signal(analysis)
            case _:
                raise ValueError(f"Unknown predict status: {self.status!r}")

    def _evaluate_signal(self, source: str) -> LatencyAnalysis | None:
        prices = self.orderbook.get_price()
        yes_ask = prices["yes"]["ask"]
        no_ask = prices["no"]["ask"]

        analysis = get_combined_latency_signal(
            binance_price=self.binance_price,
            coinbase_price=self.coinbase_price,
            chainlink_price=self.chainlink_price,
            start_price=self.start_price,
            yes_price=yes_ask,
            no_price=no_ask,
        )

        if self.save_log:
            self._persist_snapshot(source, analysis)

        return analysis

    def _persist_snapshot(self, source: str, analysis: LatencyAnalysis) -> None:
        record: dict[str, Any] = {
            "time": time.monotonic(),
            "bot_state": self.status.value,
            "trigger_source": source,
            "analysis": analysis.to_snapshot()
        }
        try:
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
        except OSError as exc:
            logger.warning("Failed to persist latency snapshot: %s", exc)

    def stop_orders(self) -> None:
        """Cancel any running order tasks when transitioning to STOPPED."""
        if self._order_task and not self._order_task.done():
            self._order_task.cancel()
            self._order_task = None

    def _check_entry_signal(self, analysis: LatencyAnalysis) -> None:
        """READY state: evaluate signal and transition to BUYING if criteria met."""
        forward = analysis.forward_model
        # TODO: calibrate this threshold from persisted data
        ev_threshold = 0.05
        if forward.ev >= ev_threshold:
            logger.info(
                "ENTRY SIGNAL | slug=%s side=%s ev=%+.3f edge=%+.4f "
                "diff=$%+.2f odds_rate=%+.3f",
                self.slug,
                forward.side_label,
                forward.ev,
                forward.edge,
                forward.diff,
                forward.odds_rate,
            )
            self.status = PredictStatus.BUYING
            self._order_task = asyncio.create_task(self._submit_buy_order(analysis), name=f"buy-{self.slug}")

    def _check_exit_signal(self, analysis: LatencyAnalysis) -> None:
        """HOLDING state: model-driven take-profit / stop-loss.

        Sell when the forward model predicts AGAINST the held position
        with sufficient conviction (ev >= exit threshold).
        """
        trade = self.active_trade
        if not trade:
            raise RuntimeError("No active trade found in state")

        forward = analysis.forward_model
        model_disagrees = (forward.side != trade.side)
        exit_ev_threshold = 0.03

        # Current bid for P&L logging
        prices = self.orderbook.get_price()
        side_prices = prices["yes"] if trade.side == "up" else prices["no"]
        current_bid = side_prices["bid"] or trade.entry_price
        unrealized_pnl = current_bid - trade.entry_price

        if not (model_disagrees and forward.ev >= exit_ev_threshold):
            return

        reason = "take-profit" if unrealized_pnl > 0 else "stop-loss"
        logger.info(
            "EXIT SIGNAL | slug=%s reason=%s held=%s model=%s model_ev=%+.3f "
            "unrealized_pnl=%+.4f entry=%.3f current_bid=%.3f",
            self.slug,
            reason,
            trade.side,
            forward.side,
            forward.ev,
            unrealized_pnl,
            trade.entry_price,
            current_bid,
        )
        self.status = PredictStatus.SELLING
        self._order_task = asyncio.create_task(
            self._submit_sell_order(analysis, current_bid),
            name=f"sell-{self.slug}",
        )

    def _log_signal(self, analysis: LatencyAnalysis) -> None:
        """WATCHING state: compute and log signal without acting."""
        fwd = analysis.forward_model
        cur = analysis.current_model
        logger.info(
            "WATCH | slug=%s fwd_side=%s fwd_ev=%+.3f fwd_edge=%+.4f "
            "cur_side=%s cur_ev=%+.3f cur_edge=%+.4f",
            self.slug,
            fwd.side_label, fwd.ev, fwd.edge,
            cur.side_label, cur.ev, cur.edge,
        )

    # ── Order execution (async, non-blocking) ─────────────────────

    @property
    def active_trade(self) -> Trade | None:
        """Return the last trade if its entry has been filled (i.e. we are holding)."""
        if self.trades and self.trades[-1].enter.filled is not None and self.trades[-1].exit is None:
            return self.trades[-1]
        return None

    async def _submit_buy_order(self, analysis: LatencyAnalysis) -> None:
        """Place a minimum buy order via smart_minimum_order, then poll for fill.

        Flow:
        1. Place order. Non-recoverable error → STOPPED + SystemExit.
           Recoverable error → back to READY.
        2. Check fill status with exponential backoff (0s, 2s, 4s).
           FILLED → record trade.filled, transition to HOLDING.
           Still OPEN after all retries → cancel order, back to READY.
        """
        forward = analysis.forward_model
        outcome_name = "Up" if forward.side == "up" else "Down"
        price = forward.side_price

        enter_record = OrderRecord(
            signal=analysis,
            start=time.time(),
        )
        trade = Trade(
            side=forward.side,
            outcome_name=outcome_name,
            entry_price=price,
            enter=enter_record,
        )
        self.trades.append(trade)

        # ── Step 1: place the order ──────────────────────────────
        try:
            result = await self.client.smart_minimum_order(
                market=self.market,
                outcome_name=outcome_name,
                price=price,
                side="BUY",
                is_post_only=False,
                return_full_response=True,
            )
        except Exception as exc:
            self._on_order_error(exc, recovering_to=PredictStatus.READY)
            return

        if result is None:
            logger.warning("Buy order returned None — treating as recoverable")
            self.status = PredictStatus.READY
            return

        data = result.get("data", {})
        order_hash = data.get("orderHash")
        order_id = data.get("orderId")
        enter_record.order_hash = order_hash
        enter_record.order_id = str(order_id) if order_id else None

        if not order_hash:
            logger.error("Order created but no orderHash in response — back to READY")
            self.status = PredictStatus.READY
            return

        logger.info(
            "BUY ORDER PLACED | slug=%s outcome=%s price=%.3f hash=%s",
            self.slug, outcome_name, price, order_hash,
        )

        # ── Step 2: poll for fill with backoff (0s, 2s, 4s) ─────
        for delay in _FILL_CHECK_DELAYS:
            if delay > 0:
                await asyncio.sleep(delay)

            try:
                order_data = await self.client.get_order_by_hash(order_hash, return_full_response=False)
            except Exception as exc:
                self._on_order_error(exc, recovering_to=PredictStatus.READY)
                return

            if order_data is None:
                logger.warning("get_order_by_hash returned None — treating as recoverable")
                self.status = PredictStatus.READY
                return

            status = order_data.get("status", "")
            logger.info(
                "ORDER CHECK | slug=%s hash=%s status=%s delay=%ds",
                self.slug, order_hash, status, delay,
            )

            if status == "FILLED":
                enter_record.filled = time.time()
                self.status = PredictStatus.HOLDING
                logger.info(
                    "BUY FILLED | slug=%s outcome=%s price=%.3f "
                    "fill_time=%.2fs hash=%s",
                    self.slug, outcome_name, price,
                    enter_record.filled - enter_record.start, order_hash,
                )
                return

            if status != "OPEN":
                # EXPIRED / CANCELLED / INVALIDATED — nothing to cancel
                logger.warning(
                    "Order ended with status=%s before fill — back to READY",
                    status,
                )
                self.status = PredictStatus.READY
                return

        # ── Step 3: still OPEN after all retries → cancel ────────
        logger.warning(
            "Order still OPEN after %d checks — cancelling | slug=%s hash=%s",
            len(_FILL_CHECK_DELAYS), self.slug, order_hash,
        )
        try:
            if enter_record.order_id:
                await self.client.cancel_orders([enter_record.order_id])
        except Exception as exc:
            self._on_order_error(exc, recovering_to=PredictStatus.READY)
            return

        self.status = PredictStatus.READY

    async def _submit_sell_order(
        self,
        analysis: LatencyAnalysis,
        sell_price: float,
    ) -> None:
        """Place a sell order via smart_minimum_order, then poll for fill.

        Flow:
        1. Place order. Non-recoverable error → STOPPED + SystemExit.
           Recoverable error → back to HOLDING.
        2. Check fill status with exponential backoff (0s, 2s, 4s).
           FILLED → compute pnl, transition to READY.
           Still OPEN after all retries → cancel, back to HOLDING.
        """
        trade = self.active_trade
        if not trade:
            logger.error("Cannot sell: no active trade in state")
            self.status = PredictStatus.HOLDING
            return

        exit_record = OrderRecord(
            signal=analysis,
            start=time.time(),
        )
        trade.exit = exit_record

        # ── Step 1: place the sell order ──────────────────────────
        try:
            result = await self.client.smart_minimum_order(
                market=self.market,
                outcome_name=trade.outcome_name,
                price=sell_price,
                side="SELL",
                is_post_only=False,
                return_full_response=True,
            )
        except Exception as exc:
            trade.exit = None  # roll back
            self._on_order_error(exc, recovering_to=PredictStatus.HOLDING)
            return

        if result is None:
            logger.warning("Sell order returned None — treating as recoverable")
            trade.exit = None
            self.status = PredictStatus.HOLDING
            return

        data = result.get("data", {})
        order_hash = data.get("orderHash")
        order_id = data.get("orderId")
        exit_record.order_hash = order_hash
        exit_record.order_id = str(order_id) if order_id else None

        if not order_hash:
            logger.error("Sell order created but no orderHash — back to HOLDING")
            trade.exit = None
            self.status = PredictStatus.HOLDING
            return

        logger.info(
            "SELL ORDER PLACED | slug=%s outcome=%s price=%.3f hash=%s",
            self.slug, trade.outcome_name, sell_price, order_hash,
        )

        # ── Step 2: poll for fill with backoff (0s, 2s, 4s) ─────
        for delay in _FILL_CHECK_DELAYS:
            if delay > 0:
                await asyncio.sleep(delay)

            try:
                order_data = await self.client.get_order_by_hash(order_hash, return_full_response=False)
            except Exception as exc:
                trade.exit = None
                self._on_order_error(exc, recovering_to=PredictStatus.HOLDING)
                return

            if order_data is None:
                logger.warning("get_order_by_hash returned None — treating as recoverable")
                trade.exit = None
                self.status = PredictStatus.HOLDING
                return

            status = order_data.get("status", "")
            logger.info(
                "SELL CHECK | slug=%s hash=%s status=%s delay=%ds",
                self.slug, order_hash, status, delay,
            )

            if status == "FILLED":
                exit_record.filled = time.time()
                trade.exit_price = sell_price
                trade.pnl = sell_price - trade.entry_price
                self.status = PredictStatus.READY
                logger.info(
                    "SELL FILLED | slug=%s outcome=%s exit=%.3f entry=%.3f "
                    "pnl=%+.4f fill_time=%.2fs hash=%s",
                    self.slug, trade.outcome_name, sell_price,
                    trade.entry_price, trade.pnl,
                    exit_record.filled - exit_record.start, order_hash,
                )
                return

            if status != "OPEN":
                logger.warning(
                    "Sell order ended with status=%s before fill — back to HOLDING",
                    status,
                )
                trade.exit = None
                self.status = PredictStatus.HOLDING
                return

        # ── Step 3: still OPEN after all retries → cancel ────────
        logger.warning(
            "Sell order still OPEN after %d checks — cancelling | slug=%s hash=%s",
            len(_FILL_CHECK_DELAYS), self.slug, order_hash,
        )
        try:
            if exit_record.order_id:
                await self.client.cancel_orders([exit_record.order_id])
        except Exception as exc:
            trade.exit = None
            self._on_order_error(exc, recovering_to=PredictStatus.HOLDING)
            return

        trade.exit = None
        self.status = PredictStatus.HOLDING

    def _on_order_error(
        self,
        exc: Exception,
        *,
        recovering_to: PredictStatus,
    ) -> None:
        """Classify order error as recoverable or non-recoverable.

        Non-recoverable errors (insufficient funds, jurisdiction blocked,
        unauthorized) transition to STOPPED and raise SystemExit so the
        bot process terminates.
        """
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            body = exc.response.text.lower()

            non_recoverable_keywords = (
                "insufficient", "balance", "funds", "allowance",
                "jurisdiction", "forbidden", "unauthorized",
            )
            if status in (400, 401, 403) and any(kw in body for kw in non_recoverable_keywords):
                logger.error(
                    "NON-RECOVERABLE ORDER ERROR: %s %s — stopping bot",
                    status,
                    exc.response.text[:300],
                )
                self.status = PredictStatus.STOPPED
                self.stop_orders()
                raise SystemExit(f"Non-recoverable order error: {status} {exc.response.text[:200]}")

        logger.warning(
            "RECOVERABLE ORDER ERROR: %s — reverting to %s",
            exc,
            recovering_to.value,
        )
        self.status = recovering_to

    def render(self, level: int = 10) -> None:
        binance_gap = self.binance_price - self.chainlink_price
        coinbase_gap = self.coinbase_price - self.chainlink_price
        provider = self.price_feed_provider or "Oracle"

        logger.info("\n" + "=" * 50)
        logger.info(f"Market Slug : {self.slug}")
        logger.info(f"Bitcoin open price: ${self.start_price:.2f}")
        logger.info(
            f"{provider:<11} : ${self.chainlink_price:.2f} "
            f"(delta: ${self.chainlink_price - self.start_price:+.2f})"
        )
        logger.info(f"Binance     : ${self.binance_price:.2f} (Gap: ${binance_gap:+.2f})")
        logger.info(f"Coinbase    : ${self.coinbase_price:.2f} (Gap: ${coinbase_gap:+.2f})")
        logger.info("=" * 50)
        self.orderbook.render(level)
        imbalance_ratio = self.orderbook.get_imbalance(level)
        logger.info(f"Imbalance Ratio: {imbalance_ratio:.2f}")
        logger.info("=" * 50)

    def resolve(self, market_data: dict[str, Any]) -> None:
        result = market_data.get("resolution").get('name') # Up / Down
        # todo