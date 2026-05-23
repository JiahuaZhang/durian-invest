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
    diff: float            # price_source - open_price (USD)
    p_up: float            # modeled P(up)
    side: str              # "up" or "down"
    side_price: float      # current ask we'd buy at
    edge: float            # modeled_prob - side_price
    ev: float              # edge / side_price — expected return per dollar risked
    chainlink_price: float
    binance_price: float
    coinbase_price: float
    open_price: float
    odds_rate: float       # 5-min market odds rate vs current price gap

    @property
    def side_label(self) -> str:
        return "YES" if self.side == "up" else "NO"


def _compute_odds_rate(p_up: float, side: str, yes_price: float, no_price: float) -> float:
    """Compute the 5-min market odds rate vs current price gap.

    The odds rate compares the model's probability for the chosen side
    against the market's implied probability (the ask price).
    A positive value means the model sees better odds than the market offers.

    Returns:
        Ratio of modeled_prob / market_price - 1.  Positive = model favors entry.
    """
    if side == "up":
        modeled_prob = p_up
        market_prob = yes_price
    else:
        modeled_prob = 1.0 - p_up
        market_prob = no_price

    if market_prob <= 0:
        return float("inf")
    return modeled_prob / market_prob - 1.0


def get_expected_latency_signal(
    binance_price: float,
    coinbase_price: float,
    open_price: float,
    yes_price: float,
    no_price: float,
    chainlink_price: float = 0.0,
    k: float = 0.04,
) -> LatencySignal:
    """Compute the latency-arbitrage signal from exchange prices.

    Uses the average of Binance and Coinbase as the "expected" future
    price and compares against the 5-min window's open price.

    Args:
        binance_price: latest Binance BTC price.
        coinbase_price: latest Coinbase BTC price.
        open_price: the 5-min window's Chainlink open price.
        yes_price: current ask price for "Up" outcome.
        no_price: current ask price for "Down" outcome.
        chainlink_price: latest Chainlink price (for reference).
        k: sigmoid steepness (default 0.04).

    Returns:
        A ``LatencySignal`` with edge and ev fields.
    """
    avg_price = (binance_price + coinbase_price) / 2
    diff = avg_price - open_price
    p_up = estimate_up_probability(diff, k)

    if p_up >= 0.5:
        side = "up"
        edge = p_up - yes_price
        side_price = yes_price
    else:
        side = "down"
        edge = (1.0 - p_up) - no_price
        side_price = no_price

    ev = edge / side_price if side_price > 0 else float("inf")
    odds_rate = _compute_odds_rate(p_up, side, yes_price, no_price)

    logger.debug(
        "EXPECTED_LATENCY: side=%s diff=$%+.2f p_up=%.3f edge=%+.3f ev=%+.2f side_price=$%.2f odds_rate=%+.3f",
        side, diff, p_up, edge, ev, side_price, odds_rate,
    )

    return LatencySignal(
        side=side,
        diff=diff,
        p_up=p_up,
        edge=edge,
        ev=ev,
        side_price=side_price,
        chainlink_price=chainlink_price,
        binance_price=binance_price,
        coinbase_price=coinbase_price,
        open_price=open_price,
        odds_rate=odds_rate,
    )


def get_current_latency_signal(
    chainlink_price: float,
    open_price: float,
    yes_price: float,
    no_price: float,
    k: float = 0.04,
) -> LatencySignal:
    """Compute the latency signal from the current Chainlink price.

    Unlike ``get_expected_latency_signal`` which uses the leading exchange
    average, this uses the *current* Chainlink price directly.  This is
    useful for comparing the "real-time settled" view against the market
    odds and for modelling the 5-min market odds rate vs the current
    price gap.

    Args:
        chainlink_price: latest Chainlink BTC price.
        open_price: the 5-min window's Chainlink open price.
        yes_price: current ask price for "Up" outcome.
        no_price: current ask price for "Down" outcome.
        k: sigmoid steepness (default 0.04).

    Returns:
        A ``LatencySignal`` with edge, ev, and odds_rate fields.
    """
    diff = chainlink_price - open_price
    p_up = estimate_up_probability(diff, k)

    if p_up >= 0.5:
        side = "up"
        edge = p_up - yes_price
        side_price = yes_price
    else:
        side = "down"
        edge = (1.0 - p_up) - no_price
        side_price = no_price

    ev = edge / side_price if side_price > 0 else float("inf")
    odds_rate = _compute_odds_rate(p_up, side, yes_price, no_price)

    logger.debug(
        "CURRENT_LATENCY: side=%s diff=$%+.2f p_up=%.3f edge=%+.3f ev=%+.2f side_price=$%.2f odds_rate=%+.3f",
        side, diff, p_up, edge, ev, side_price, odds_rate,
    )

    return LatencySignal(
        side=side,
        diff=diff,
        p_up=p_up,
        edge=edge,
        ev=ev,
        side_price=side_price,
        chainlink_price=chainlink_price,
        binance_price=0.0,
        coinbase_price=0.0,
        open_price=open_price,
        odds_rate=odds_rate,
    )