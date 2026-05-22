"""
Price divergence signal: exchange average vs Chainlink.

The edge: Chainlink feed lags behind Binance/Coinbase by seconds.
When exchanges move >$50 but Chainlink hasn't updated, shares are mispriced.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Literal

from ..state.polymarket_order_book import PolymarketOrderBook

logger = logging.getLogger(__name__)

PriceSource = Literal["binance", "coinbase", "chainlink"]


def check_divergence(
    binance_price: float,
    coinbase_price: float,
    chainlink_price: float,
    threshold: float = 50.0,
) -> str | None:
    """
    Detect price divergence between exchange average and Chainlink.

    Returns a dictionary:
        {
            "direction": "UP" | "DOWN" | None,
            "binance_gap": float,
            "coinbase_gap": float,
        }
    """
    binance_gap = binance_price - chainlink_price
    coinbase_gap = coinbase_price - chainlink_price

    exchanges_agree = (
        (binance_gap > threshold and coinbase_gap > threshold) 
        or (binance_gap < -threshold and coinbase_gap < -threshold)
    )

    direction = None
    if exchanges_agree:
        direction = "UP" if binance_gap > threshold else "DOWN"
        logger.info(
            f"DIVERGENCE DETECTED: {direction}: chainlink={chainlink_price:.2f} "
            f"binance={binance_price:.2f} binance_gap={binance_gap:+.2f} "
            f"coinbase={coinbase_price:.2f} coinbase_gap={coinbase_gap:+.2f}"
        )

    return {
        "direction": direction,
        "binance_gap": binance_gap,
        "coinbase_gap": coinbase_gap,
    }

@dataclass(frozen=True)
class TradeSignal:
    """The exact market state and decision that caused an entry signal."""
    source: PriceSource
    side: str
    open_price: float | None

    binance_price: float
    coinbase_price: float
    chainlink_price: float

    binance_gap: float
    coinbase_gap: float

    divergence: str
    imbalance: str
    imbalance_ratio: float

    entry_price: float
    bid_price: float
    ask_price: float

    @property
    def side_label(self) -> str:
        return "YES" if self.side == "up" else "NO"


def get_signal(
    source: PriceSource,
    open_price: float | None,
    binance_price: float,
    coinbase_price: float,
    chainlink_price: float,
    order_book: PolymarketOrderBook,
    divergence_threshold: float = 50.0,
    imbalance_levels: int = 10,
    bullish_threshold: float = 1.8,
    bearish_threshold: float = 0.55,
) -> TradeSignal | None:
    divergence_data = check_divergence(
        binance_price,
        coinbase_price,
        chainlink_price,
        threshold=divergence_threshold,
    )

    direction = divergence_data.get("direction")
    binance_gap = divergence_data.get("binance_gap", 0.0)
    coinbase_gap = divergence_data.get("coinbase_gap", 0.0)

    if not direction:
        return None

    ratio = order_book.get_imbalance(level=imbalance_levels)
    imbalance = None
    if ratio >= bullish_threshold:
        imbalance = "BULLISH"
    elif ratio <= bearish_threshold:
        imbalance = "BEARISH"

    if not imbalance:
        logger.info(
            "!!! NO TRADE: divergence=%s binance_gap=$%+2f coinbase_gap=$%+2f but imbalance=%s ratio=%.2f",
            direction,
            binance_gap,
            coinbase_gap,
            imbalance,
            ratio
        )
        return None

    prices = order_book.get_price()
    
    if direction == "UP" and imbalance == "BULLISH":
        side = "up"
        side_prices = prices["yes"]
    elif direction == "DOWN" and imbalance == "BEARISH":
        side = "down"
        side_prices = prices["no"]
    else:
        logger.info(
            "!!! NO TRADE: divergence=%s binance_gap=$%+2f coinbase_gap=$%+2f but imbalance=%s ratio=%.2f",
            direction,
            binance_gap,
            coinbase_gap,
            imbalance,
            ratio
        )
        return None

    bid_price = side_prices["bid"] or 0.0
    ask_price = side_prices["ask"] or 0.0
    entry_price = ask_price

    logger.info(
        "SIGNAL: BUY %s divergence=%s imbalance=%s ratio=%.2f binance_gap=$%+.2f coinbase_gap=$%+.2f",
        direction,
        imbalance,
        ratio,
        binance_gap,
        coinbase_gap,
    )

    return TradeSignal(
        source=source,
        side=side,
        open_price=open_price,
        binance_price=binance_price,
        coinbase_price=coinbase_price,
        chainlink_price=chainlink_price,
        binance_gap=binance_gap,
        coinbase_gap=coinbase_gap,
        divergence=direction,
        imbalance=imbalance,
        imbalance_ratio=ratio,
        entry_price=entry_price,
        bid_price=bid_price,
        ask_price=ask_price,
    )


# ── Latency-based probability signal ────────────────────────────

def estimate_up_probability(diff: float, k: float = 0.04) -> float:
    """Map a USD price difference to P(up) via sigmoid.

    ``diff`` = avg_exchange_price - open_price.
    Positive diff → exchanges moved up → Chainlink likely to follow → P(up) > 0.5.

    Args:
        diff: price difference in USD.
        k: steepness — larger values mean the curve saturates faster.
            With k=0.04: $25 → 73%, $50 → 88%, $100 → 98%.

    Returns:
        Probability in [0, 1].
    """
    return 1.0 / (1.0 + math.exp(-k * diff))


@dataclass(frozen=True)
class LatencySignal:
    """Signal from the latency-based probability model."""
    side: str              # "up" or "down"
    diff: float            # avg_exchange - open_price (USD)
    p_up: float            # modeled P(up)
    edge: float            # modeled_prob - market_price
    ev: float              # edge / market_price — expected return per dollar risked
    market_price: float    # current ask we'd buy at
    binance_price: float
    coinbase_price: float
    open_price: float

    @property
    def side_label(self) -> str:
        return "YES" if self.side == "up" else "NO"


def get_latency_signal(
    binance_price: float,
    coinbase_price: float,
    open_price: float,
    yes_price: float,
    no_price: float,
    k: float = 0.04,
) -> LatencySignal:
    """Compute the latency-arbitrage signal snapshot.

    Always returns a ``LatencySignal`` with the modeled probability,
    edge, and expected value so callers can decide entry, exit, or
    stop-loss thresholds themselves.

    Args:
        binance_price: latest Binance BTC price.
        coinbase_price: latest Coinbase BTC price.
        open_price: the 5-min window's Chainlink open price.
        yes_price: current ask price for "Up" outcome.
        no_price: current ask price for "Down" outcome.
        k: sigmoid steepness (default 0.04).

    Returns:
        A ``LatencySignal`` with edge and ev fields.
    """
    avg_price = (binance_price + coinbase_price) / 2
    diff = avg_price - open_price
    p_up = estimate_up_probability(diff, k)

    # Model leans up → only consider buying "yes"; leans down → only "no".
    if p_up >= 0.5:
        side = "up"
        edge = p_up - yes_price
        market_price = yes_price
    else:
        side = "down"
        edge = (1.0 - p_up) - no_price
        market_price = no_price

    ev = edge / market_price if market_price > 0 else float("inf")

    logger.debug(
        "LATENCY: side=%s diff=$%+.2f p_up=%.3f edge=%+.3f ev=%+.2f market=$%.2f",
        side, diff, p_up, edge, ev, market_price,
    )

    return LatencySignal(
        side=side,
        diff=diff,
        p_up=p_up,
        edge=edge,
        ev=ev,
        market_price=market_price,
        binance_price=binance_price,
        coinbase_price=coinbase_price,
        open_price=open_price,
    )