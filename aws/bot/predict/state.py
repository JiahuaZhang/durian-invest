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
from dataclasses import dataclass, asdict
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
    READY = "ready"
    BUYING = "buying"
    HOLDING = "holding"
    SELLING = "selling"
    WATCHING = "watching"
    STOPPED = "stopped"

@dataclass(frozen=True)
class PredictExitDecision:
    reason: str
    side: str
    token_index: int
    price: float
    entry_price: float
    pnl_per_share: float

class PredictState:
    """Single-market state for predict.fun, structured like PolymarketState."""

    def __init__(
        self,
        cfg: BotConfig,
        client: PredictClient,
        market: dict[str, Any],
        *,
        watching: bool = False,
    ):
        self.cfg = cfg
        self.client = client
        self.market = market

        self.start_price = market.get("variantData").get("startPrice")
        self.status = PredictStatus.WATCHING if watching else PredictStatus.READY
        self.orders: list[dict[str, Any]] = []
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

        self.trade: dict[str, Any] | None = None
        self.exit_decision: PredictExitDecision | None = None

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

    @property
    def prices_ready(self) -> bool:
        return self.binance_price > 0 and self.coinbase_price > 0 and self.chainlink_price > 0

    def seed_prices(
        self,
        *,
        binance: float = 0.0,
        coinbase: float = 0.0,
        chainlink: float = 0.0,
    ) -> None:
        """Seed latest prices when activating a new 5-minute state."""
        now = time.monotonic()
        for source, price in (
            ("binance", binance),
            ("coinbase", coinbase),
            ("chainlink", chainlink),
        ):
            if price > 0:
                self._set_price(source, price, now)

    def update_price(
        self,
        source: PredictPriceSource,
        price: float,
    ) -> None:
        """Update one price source."""
        self._set_price(source, price, time.monotonic())

    def _set_price(self, source: PredictPriceSource, price: float, updated_at: float) -> None:
        if price <= 0:
            return
        if source == "binance":
            self.binance_price = price
        elif source == "coinbase":
            self.coinbase_price = price
        elif source == "chainlink":
            self.chainlink_price = price
        else:
            raise ValueError(f"Unknown predict price source: {source!r}")
        self.last_price_update[source] = updated_at

    def apply_message(self, message: dict[str, Any]) -> bool:
        """Route an incoming predict.fun WS frame to the orderbook or price feed."""
        topic = str(message.get("topic") or "")
        data = message.get("data") or {}

        if topic.startswith("predictOrderbook/"):
            return self._apply_orderbook(data)

        return False

    def _apply_orderbook(self, data: dict[str, Any]) -> bool:
        if "marketId" in data:
            try:
                if int(data["marketId"]) != self.market_id:
                    return False
            except (TypeError, ValueError):
                return False

        before = self.orderbook.last_update
        self.orderbook.apply(data)
        return self.orderbook.last_update != before

    def stop_orders(self) -> None:
        """Cancel any running order tasks when transitioning to STOPPED."""
        if self._order_task and not self._order_task.done():
            self._order_task.cancel()
            self._order_task = None

    def tick(self, source: str, need_log: bool, log_path: Path | None) -> None:
        """
        Evaluate state machine for this tick.
        Called by manager on every price update or orderbook update.
        """
        if self.status not in (PredictStatus.READY, PredictStatus.HOLDING, PredictStatus.WATCHING):
            return

        analysis = self._evaluate_signal(source, need_log, log_path)
        if analysis is None:
            return

        if self.status == PredictStatus.READY:
            self._check_entry_signal(analysis)
        elif self.status == PredictStatus.HOLDING:
            self._check_exit_signal(analysis)
        elif self.status == PredictStatus.WATCHING:
            self._log_signal(analysis, source)

    def _evaluate_signal(self, source: str, need_log: bool, log_path: Path | None) -> LatencyAnalysis | None:
        if not self.prices_ready or not self.start_price or self.start_price <= 0:
            return None

        prices = self.orderbook.get_price()
        yes_ask = prices["yes"]["ask"]
        no_ask = prices["no"]["ask"]
        if yes_ask <= 0 or no_ask <= 0:
            return None

        analysis = get_combined_latency_signal(
            binance_price=self.binance_price,
            coinbase_price=self.coinbase_price,
            chainlink_price=self.chainlink_price,
            open_price=self.start_price,
            yes_price=yes_ask,
            no_price=no_ask,
        )

        if need_log and log_path:
            self._persist_snapshot(source, analysis, log_path)

        return analysis

    def _persist_snapshot(
        self,
        source: str,
        analysis: LatencyAnalysis,
        log_path: Path,
    ) -> None:
        prices = self.orderbook.get_price()
        record: dict[str, Any] = {
            "ts": time.time(),
            "slug": self.slug,
            "market_id": self.market_id,
            "bot_state": self.status.value,
            "trigger_source": source,
            "current_model": asdict(analysis.current_model),
            "forward_model": asdict(analysis.forward_model),
            "open_price": analysis.open_price,
            "binance_price": analysis.binance_price,
            "coinbase_price": analysis.coinbase_price,
            "chainlink_price": analysis.chainlink_price,
            "yes_bid": prices["yes"]["bid"],
            "yes_ask": prices["yes"]["ask"],
            "no_bid": prices["no"]["bid"],
            "no_ask": prices["no"]["ask"],
            "imbalance_ratio": self.orderbook.get_imbalance(
                level=self.cfg.signals.imbalance_levels,
            ),
        }
        try:
            with log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
        except OSError as exc:
            logger.warning("Failed to persist latency snapshot: %s", exc)

    def _check_entry_signal(self, analysis: LatencyAnalysis) -> None:
        """READY state: evaluate signal and transition to BUYING if criteria met."""
        forward = analysis.forward_model
        # TODO: calibrate this threshold from persisted data
        ev_threshold = 0.05
        if forward.ev >= ev_threshold and forward.edge > 0:
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
            self._order_task = asyncio.create_task(
                self._submit_buy_order(analysis),
                name=f"buy-{self.slug}",
            )

    def _check_exit_signal(self, analysis: LatencyAnalysis) -> None:
        """HOLDING state: check for stop-loss or take-profit."""
        exit_decision = self.check_exit()
        if exit_decision is not None:
            logger.info(
                "EXIT SIGNAL | slug=%s reason=%s price=%.3f "
                "entry=%.3f pnl_per_share=%+.4f",
                self.slug,
                exit_decision.reason,
                exit_decision.price,
                exit_decision.entry_price,
                exit_decision.pnl_per_share,
            )
            self.mark_exit(exit_decision)
            self.status = PredictStatus.SELLING
            self._order_task = asyncio.create_task(
                self._submit_sell_order(exit_decision),
                name=f"sell-{self.slug}",
            )

    def _log_signal(self, analysis: LatencyAnalysis, source: str) -> None:
        """WATCHING state: compute and log signal without acting."""
        fwd = analysis.forward_model
        cur = analysis.current_model
        logger.info(
            "WATCH %s | slug=%s fwd_side=%s fwd_ev=%+.3f fwd_edge=%+.4f "
            "cur_side=%s cur_ev=%+.3f cur_edge=%+.4f",
            source,
            self.slug,
            fwd.side_label, fwd.ev, fwd.edge,
            cur.side_label, cur.ev, cur.edge,
        )

    # ── Order execution (async, non-blocking) ─────────────────────

    async def _submit_buy_order(
        self,
        analysis: LatencyAnalysis,
    ) -> None:
        """Submit a buy order asynchronously. Transitions state on result."""
        forward = analysis.forward_model
        outcome_name = "Up" if forward.side == "up" else "Down"
        price = forward.side_price

        try:
            result = await self.client.place_limit_order(
                market=self.market,
                outcome_name=outcome_name,
                side="BUY",
                price=price,
                size=self.cfg.order_size,
            )

            if result is None:
                logger.warning("Buy order returned None — treating as recoverable")
                self.status = PredictStatus.READY
                return

            token_index = 0 if forward.side == "up" else 1
            token_id = (
                self.yes_token_id
                if token_index == 0
                else self.no_token_id
            )
            trade_info = {
                "side": forward.side,
                "token_index": token_index,
                "token_id": token_id,
                "entry_price": price,
                "order_result": result,
            }
            self.trade = trade_info
            self.orders.append(trade_info)
            self.status = PredictStatus.HOLDING

            logger.info(
                "BUY FILLED | slug=%s outcome=%s price=%.3f size=%.1f",
                self.slug,
                outcome_name,
                price,
                self.cfg.order_size,
            )

        except Exception as exc:
            self._on_order_error(exc, recovering_to=PredictStatus.READY)

    async def _submit_sell_order(
        self,
        exit_decision: PredictExitDecision,
    ) -> None:
        """Submit a sell order asynchronously. Transitions state on result."""
        if not self.trade:
            logger.error("Cannot sell: no position tracked in state")
            self.status = PredictStatus.READY
            return

        outcome_name = "Up" if self.trade["side"] == "up" else "Down"
        price = exit_decision.price

        try:
            result = await self.client.place_limit_order(
                market=self.market,
                outcome_name=outcome_name,
                side="SELL",
                price=price,
                size=self.cfg.order_size,
            )

            if result is None:
                logger.warning("Sell order returned None — treating as recoverable")
                self.status = PredictStatus.HOLDING
                return

            pnl = exit_decision.pnl_per_share * self.cfg.order_size
            
            sell_info = {
                "action": "sell",
                "side": self.trade["side"],
                "exit_price": price,
                "entry_price": exit_decision.entry_price,
                "reason": exit_decision.reason,
                "order_result": result,
            }
            self.orders.append(sell_info)

            logger.info(
                "SELL FILLED | slug=%s outcome=%s exit=%.3f entry=%.3f "
                "pnl=$%+.4f reason=%s",
                self.slug,
                outcome_name,
                price,
                exit_decision.entry_price,
                pnl,
                exit_decision.reason,
            )

            self.status = PredictStatus.READY

        except Exception as exc:
            self._on_order_error(exc, recovering_to=PredictStatus.HOLDING)

    def _on_order_error(
        self,
        exc: Exception,
        *,
        recovering_to: PredictStatus,
    ) -> None:
        """Classify order error as recoverable or non-recoverable."""
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            body = exc.response.text.lower()

            non_recoverable_keywords = (
                "insufficient", "balance", "funds", "allowance",
            )
            if status in (400, 403) and any(kw in body for kw in non_recoverable_keywords):
                logger.error(
                    "NON-RECOVERABLE ORDER ERROR: %s %s — stopping state",
                    status,
                    exc.response.text[:300],
                )
                self.status = PredictStatus.STOPPED
                self.stop_orders()
                return

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

    def check_exit(self) -> PredictExitDecision | None:
        if not self.trade or self.exit_decision or self.resolved:
            return None

        prices = self.orderbook.get_price()
        side = self.trade["side"]
        side_prices = prices["yes"] if side == "up" else prices["no"]
        current_bid = side_prices["bid"] or float(self.trade["entry_price"])
        entry = float(self.trade["entry_price"])

        reason = None
        if current_bid >= self.cfg.exit.take_profit:
            reason = "Take Profit"
        elif current_bid <= self.cfg.exit.stop_loss:
            reason = "Stop Loss"

        if reason is None:
            return None

        return PredictExitDecision(
            reason=reason,
            side=side,
            token_index=int(self.trade["token_index"]),
            price=current_bid,
            entry_price=entry,
            pnl_per_share=current_bid - entry,
        )

    def mark_exit(self, decision: PredictExitDecision) -> None:
        if self.trade:
            self.trade["exit_price"] = decision.price
            self.trade["exit_reason"] = decision.reason
        self.exit_decision = decision

    def resolve(self, market_data: dict[str, Any]) -> None:
        result = market_data.get("resolution").get('name') # Up / Down
        # todo