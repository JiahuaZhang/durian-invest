from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from ..config import BotConfig
from ..markets import Market
from ..signals.divergence import TradeSignal, get_signal, PriceSource
from ..state.polymarket_order_book import PolymarketOrderBook

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExitDecision:
    """A take-profit or stop-loss decision for an active trade."""

    reason: str
    side: str
    token_index: int
    price: float
    entry_price: float
    pnl_per_share: float


@dataclass(frozen=True)
class ResolutionResult:
    """Final realized or simulated P&L once Polymarket resolves the market."""

    slug: str
    side: str | None
    winning_asset_id: str
    won: bool | None
    entry_price: float | None
    exit_price: float | None
    exit_reason: str | None
    pnl_per_share: float
    pnl_total: float


class PolymarketState:
    """
    Single-market, single-asset state.

    The strategy owns websocket/feed lifecycles and routes events into this object.
    This keeps signal calculation fast and avoids networking from price callbacks.
    """

    def __init__(
        self,
        cfg: BotConfig,
        market: Market,
        *,
        asset: str,
        open_price: float | None,
        start_ts: int,
        end_ts: int,
    ):
        self.cfg = cfg
        self.market = market
        self.asset = asset
        self.open_price = open_price
        self.start_ts = start_ts
        self.end_ts = end_ts

        self.orderbook = PolymarketOrderBook(asset_id=asset, side="Yes")
        self.binance_price: float = 0.0
        self.coinbase_price: float = 0.0
        self.chainlink_price: float = 0.0
        self.last_price_update: dict[PriceSource, float] = {
            "binance": 0.0,
            "coinbase": 0.0,
            "chainlink": 0.0,
        }

        self.signal_snapshot: TradeSignal | None = None
        self.trade: dict[str, Any] | None = None
        self.exit_decision: ExitDecision | None = None
        self.resolution: ResolutionResult | None = None

    @property
    def slug(self) -> str:
        return self.market.slug

    @property
    def resolved(self) -> bool:
        return self.resolution is not None

    def seconds_remaining(self, now_ts: int | None = None) -> int:
        now = int(time.time()) if now_ts is None else now_ts
        return max(0, self.end_ts - now)

    def seconds_elapsed(self, now_ts: int | None = None) -> int:
        now = int(time.time()) if now_ts is None else now_ts
        return max(0, now - self.start_ts)

    def seed_prices(
        self,
        *,
        binance: float = 0.0,
        coinbase: float = 0.0,
        chainlink: float = 0.0,
    ) -> None:
        """Seed latest feed prices when a new 5-minute state is activated."""
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
        source: PriceSource,
        price: float,
        *,
        now_ts: int | None = None,
    ) -> TradeSignal | None:
        """Update one price source and immediately evaluate the entry signal."""
        self._set_price(source, price, time.monotonic())
        return self.check_entry_signal(source=source, now_ts=now_ts)

    def apply_market_message(self, message: dict[str, Any]) -> bool:
        """Apply a CLOB websocket orderbook message for this asset."""
        event_type = message.get("event_type")
        if event_type == "book":
            if message.get("asset_id") != self.asset:
                return False
        elif event_type == "price_change":
            if not any(change.get("asset_id") == self.asset for change in message.get("price_changes", [])):
                return False
        else:
            return False

        before = self.orderbook.last_update
        self.orderbook.apply(message)
        return self.orderbook.last_update != before

    def render(self, level: int = 10) -> None:
        binance_gap = self.binance_price - self.chainlink_price
        coinbase_gap = self.coinbase_price - self.chainlink_price
        
        logger.info("\n" + "=" * 50)
        logger.info(f"Market Slug : {self.slug}")
        logger.info(f"Chainlink   : ${self.chainlink_price:.2f}")
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
        source: PriceSource,
        now_ts: int | None = None,
    ) -> TradeSignal | None:
        """Return the first aligned divergence + imbalance signal."""
        if self.resolved or self.trade or self.signal_snapshot:
            return None

        if not self.prices_ready:
            return None

        remaining = self.seconds_remaining(now_ts)

        signal = get_signal(
            source=source,
            remaining_seconds=remaining,
            open_price=self.open_price,
            binance_price=self.binance_price,
            coinbase_price=self.coinbase_price,
            chainlink_price=self.chainlink_price,
            order_book=self.orderbook,
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
        token_id = self.market.up_token_id if token_index == 0 else self.market.down_token_id
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

    def check_exit(self) -> ExitDecision | None:
        """Check active trade against take-profit and stop-loss prices."""
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

        return ExitDecision(
            reason=reason,
            side=side,
            token_index=int(self.trade["token_index"]),
            price=current_bid,
            entry_price=entry,
            pnl_per_share=current_bid - entry,
        )

    def mark_exit(self, decision: ExitDecision) -> None:
        if self.trade:
            self.trade["exit_price"] = decision.price
            self.trade["exit_reason"] = decision.reason
        self.exit_decision = decision

    def resolve(self, winning_asset_id: str) -> ResolutionResult:
        """Finalize P&L only when the market_resolved websocket event arrives."""
        if self.resolution:
            return self.resolution

        if not self.trade:
            self.resolution = ResolutionResult(
                slug=self.slug,
                side=None,
                winning_asset_id=winning_asset_id,
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
            won = winning_asset_id == token_id
            exit_price = 1.0 if won else 0.0
            exit_reason = "RESOLUTION"
            pnl_per_share = exit_price - entry

        won = winning_asset_id == token_id
        self.resolution = ResolutionResult(
            slug=self.slug,
            side=side,
            winning_asset_id=winning_asset_id,
            won=won,
            entry_price=entry,
            exit_price=exit_price,
            exit_reason=exit_reason,
            pnl_per_share=pnl_per_share,
            pnl_total=pnl_per_share * self.cfg.order_size,
        )
        return self.resolution

    @property
    def prices_ready(self) -> bool:
        return self.binance_price > 0 and self.coinbase_price > 0 and self.chainlink_price > 0

    def _set_price(self, source: PriceSource, price: float, updated_at: float) -> None:
        if price <= 0:
            return
        if source == "binance":
            self.binance_price = price
        elif source == "coinbase":
            self.coinbase_price = price
        elif source == "chainlink":
            self.chainlink_price = price
        else:
            raise ValueError(f"Unknown price source: {source!r}")
        self.last_price_update[source] = updated_at
