"""
Per-market state for predict.fun — mirror of polymarket_state.py.

Holds open-price, latest comparator prices (Binance/Coinbase, optional), the
on-platform oracle price from predict's own ``assetPriceUpdate`` WS stream,
and a PredictOrderBook driven by ``predictOrderbook`` snapshots.

When prices come in, ``update_price`` evaluates the existing divergence +
imbalance signal (signals/divergence.py). The semantic mapping versus
polymarket_state is:

    Polymarket            Predict.fun
    --------------------  ---------------------------------------------
    Binance reference     Binance reference (same external feed)
    Coinbase reference    Coinbase reference (same external feed)
    Chainlink oracle      Predict's price-feed (Pyth or Binance, per the
                          market's variantData.priceFeedProvider)

The oracle price flows in via ``apply_message`` when the WS pushes an
``assetPriceUpdate/{priceFeedId}`` frame, or directly via ``update_price``
from any caller.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Literal

from ..config import BotConfig
from ..signals.divergence import TradeSignal, get_signal
from .order_book import PredictOrderBook

logger = logging.getLogger(__name__)

# Same Literal as polymarket_state's PriceSource, but with ``oracle`` standing
# in for ``chainlink`` — semantically these are the same slot (the price the
# market resolves against).
PredictPriceSource = Literal["binance", "coinbase", "chainlink"]


@dataclass(frozen=True)
class PredictMarket:
    """Minimal market descriptor for predict.fun integration.

    Predict's full ``Market`` schema (see https://dev.predict.fun) carries
    many more fields (rewards, outcomes, resolver, etc.). This dataclass
    only captures what the strategy needs to subscribe + decide.
    """

    id: int
    slug: str
    condition_id: str
    title: str
    question: str
    is_neg_risk: bool
    fee_rate_bps: int
    yes_token_id: str
    no_token_id: str
    price_feed_id: str | None = None
    price_feed_symbol: str | None = None
    price_feed_provider: str | None = None
    start_price: float | None = None
    end_price: float | None = None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> PredictMarket | None:
        market_id = int(raw.get("id"))
        outcomes = raw.get("outcomes")
        yes_id, no_id = "", ""
        for o in outcomes:
            name = o.get("name")
            if name == "Up":
                yes_id = o.get("onChainId")
            elif name == "Down":
                no_id = o.get("onChainId")

        variant = raw.get("variantData") or {}

        return cls(
            id=market_id,
            slug=str(raw.get("categorySlug")),
            condition_id=str(raw.get("conditionId")),
            title=str(raw.get("title")),
            question=str(raw.get("question")),
            is_neg_risk=bool(raw.get("isNegRisk")),
            fee_rate_bps=int(raw.get("feeRateBps")),
            yes_token_id=yes_id,
            no_token_id=no_id,
            price_feed_id=variant.get("priceFeedId"),
            price_feed_symbol=variant.get("priceFeedSymbol"),
            price_feed_provider=variant.get("priceFeedProvider"),
            start_price=variant.get("startPrice"),
            end_price=variant.get("endPrice"),
        )


@dataclass(frozen=True)
class PredictExitDecision:
    reason: str
    side: str
    token_index: int
    price: float
    entry_price: float
    pnl_per_share: float


@dataclass(frozen=True)
class PredictResolutionResult:
    slug: str
    side: str | None
    winning_token_id: str
    won: bool | None
    entry_price: float | None
    exit_price: float | None
    exit_reason: str | None
    pnl_per_share: float
    pnl_total: float


class PredictState:
    """Single-market state for predict.fun, structured like PolymarketState."""

    def __init__(
        self,
        cfg: BotConfig,
        market: PredictMarket,
        *,
        on_signal: Callable[["PredictState", TradeSignal], None] | None = None,
    ):
        self.cfg = cfg
        self.market = market
        self.open_price: float = float(market.start_price or 0.0)
        self.on_signal = on_signal

        self.orderbook = PredictOrderBook(market_id=market.id, side="Yes")
        self.binance_price: float = 0.0
        self.coinbase_price: float = 0.0
        self.chainlink_price: float = 0.0
        self.last_price_update: dict[PredictPriceSource, float] = {
            "binance": 0.0,
            "coinbase": 0.0,
            "chainlink": 0.0,
        }

        self.signal_snapshot: TradeSignal | None = None
        self.trade: dict[str, Any] | None = None
        self.exit_decision: PredictExitDecision | None = None
        self.resolution: PredictResolutionResult | None = None

    @property
    def slug(self) -> str:
        return self.market.slug

    @property
    def resolved(self) -> bool:
        return self.resolution is not None

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
    ) -> TradeSignal | None:
        """Update one price source and re-evaluate the entry signal.

        If a signal fires and ``on_signal`` is registered, the listener is
        notified (so the manager can cancel the bridge task early and proceed
        to order placement) — same pattern as PolymarketState.
        """
        self._set_price(source, price, time.monotonic())
        signal = self.check_entry_signal(source=source)
        if signal is not None and self.on_signal is not None:
            self.on_signal(self, signal)
        return signal

    def apply_message(self, message: dict[str, Any]) -> bool:
        """Route an incoming predict.fun WS frame to the orderbook or price feed.

        Expects the shape ``{"type": "M", "topic": "...", "data": {...}}``
        as documented at https://dev.predict.fun/response-format-1915502m0.
        Returns ``True`` if the message changed local state.
        """
        topic = str(message.get("topic") or "")
        data = message.get("data") or {}

        if topic.startswith("predictOrderbook/"):
            return self._apply_orderbook(data)

        return False

    def _apply_orderbook(self, data: dict[str, Any]) -> bool:
        # Predict scopes its book to one marketId per topic; ignore mismatches
        # so a shared channel feeding multiple states doesn't cross-pollinate.
        if "marketId" in data:
            try:
                if int(data["marketId"]) != self.market.id:
                    return False
            except (TypeError, ValueError):
                return False

        before = self.orderbook.last_update
        self.orderbook.apply(data)
        return self.orderbook.last_update != before

    def render(self, level: int = 10) -> None:
        binance_gap = self.binance_price - self.chainlink_price
        coinbase_gap = self.coinbase_price - self.chainlink_price
        provider = self.market.price_feed_provider or "Oracle"

        logger.info("\n" + "=" * 50)
        logger.info(f"Market Slug : {self.slug}")
        logger.info(f"Bitcoin open price: ${self.open_price:.2f}")
        logger.info(
            f"{provider:<11} : ${self.chainlink_price:.2f} "
            f"(delta: ${self.chainlink_price - self.open_price:+.2f})"
        )
        logger.info(f"Binance     : ${self.binance_price:.2f} (Gap: ${binance_gap:+.2f})")
        logger.info(f"Coinbase    : ${self.coinbase_price:.2f} (Gap: ${coinbase_gap:+.2f})")
        logger.info("=" * 50)
        self.orderbook.render(level)
        imbalance_ratio = self.orderbook.get_imbalance(level)
        logger.info(f"Imbalance Ratio: {imbalance_ratio:.2f}")
        logger.info("=" * 50)

    def check_entry_signal(
        self,
        *,
        source: PredictPriceSource,
    ) -> TradeSignal | None:
        """Return the first aligned divergence + imbalance signal."""
        if self.resolved or self.trade or self.signal_snapshot:
            return None
        if not self.prices_ready:
            return None

        signal = get_signal(
            source=source,
            open_price=self.open_price,
            binance_price=self.binance_price,
            coinbase_price=self.coinbase_price,
            chainlink_price=self.chainlink_price,
            order_book=self.orderbook,  # type: ignore[arg-type]
            divergence_threshold=self.cfg.signals.divergence_threshold,
            imbalance_levels=self.cfg.signals.imbalance_levels,
            bullish_threshold=self.cfg.signals.imbalance_bullish,
            bearish_threshold=self.cfg.signals.imbalance_bearish,
        )

        if signal is None:
            return None

        self.signal_snapshot = signal
        return signal

    def mark_trade(self, snapshot: TradeSignal) -> dict[str, Any]:
        token_index = 0 if snapshot.side == "up" else 1
        token_id = self.market.yes_token_id if token_index == 0 else self.market.no_token_id
        self.trade = {
            "side": snapshot.side,
            "token_index": token_index,
            "token_id": token_id,
            "entry_price": snapshot.entry_price,
            "entry_bid": snapshot.bid_price,
            "entry_source": snapshot.source,
            "snapshot": snapshot,
        }
        return self.trade

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

    def resolve(self, market_data: dict[str, Any]) -> PredictResolutionResult:
        """Finalize P&L once the market settles using the actual market payload."""
        if self.resolution:
            return self.resolution

        resolution_data = market_data.get("resolution") or {}
        winning_token_id = str(resolution_data.get("onChainId") or "")

        if not self.trade:
            self.resolution = PredictResolutionResult(
                slug=self.slug,
                side=None,
                winning_token_id=winning_token_id,
                won=None,
                entry_price=None,
                exit_price=None,
                exit_reason=None,
                pnl_per_share=0.0,
                pnl_total=0.0,
            )
            return self.resolution

        side = self.trade["side"]
        token_id = self.trade["token_id"]
        entry = float(self.trade["entry_price"])

        if self.exit_decision:
            exit_price = self.exit_decision.price
            exit_reason = self.exit_decision.reason
            pnl_per_share = self.exit_decision.pnl_per_share
        else:
            won = winning_token_id == token_id
            exit_price = 1.0 if won else 0.0
            exit_reason = "RESOLUTION"
            pnl_per_share = exit_price - entry

        won = winning_token_id == token_id
        self.resolution = PredictResolutionResult(
            slug=self.slug,
            side=side,
            winning_token_id=winning_token_id,
            won=won,
            entry_price=entry,
            exit_price=exit_price,
            exit_reason=exit_reason,
            pnl_per_share=pnl_per_share,
            pnl_total=pnl_per_share * self.cfg.order_size,
        )
        return self.resolution

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


def _to_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
