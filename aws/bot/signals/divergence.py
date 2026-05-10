"""
Price divergence signal: exchange average vs Chainlink.

The edge: Chainlink feed lags behind Binance/Coinbase by seconds.
When exchanges move >$50 but Chainlink hasn't updated, shares are mispriced.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..state.polymarket_order_book import PolymarketOrderBook

logger = logging.getLogger(__name__)


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

@dataclass
class TradeSignal:
    side: str
    entry_price: float
    divergence: str
    imbalance: str
    ratio: float
    binance_gap: float
    coinbase_gap: float


def get_signal(
    divergence_data: dict,
    order_book: PolymarketOrderBook,
    imbalance_levels: int = 10,
    bullish_threshold: float = 1.8,
    bearish_threshold: float = 0.55,
) -> TradeSignal | None:
    direction = divergence_data.get("direction")
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

    binance_gap = divergence_data.get("binance_gap", 0.0)
    coinbase_gap = divergence_data.get("coinbase_gap", 0.0)

    prices = order_book.get_price()
    yes_ask = prices["yes"]["ask"] or 0.0
    no_ask = prices["no"]["ask"] or 0.0

    if direction == "UP" and imbalance == "BULLISH":
        logger.info(
            "SIGNAL: BUY UP divergence=%s imbalance=%s ratio=%.2f binance_gap=$%+.2f coinbase_gap=$%+.2f",
            direction,
            imbalance,
            ratio,
            binance_gap,
            coinbase_gap,
        )
        return TradeSignal("up", yes_ask, direction, imbalance, ratio, binance_gap, coinbase_gap)

    if direction == "DOWN" and imbalance == "BEARISH":
        logger.info(
            "SIGNAL: BUY DOWN divergence=%s imbalance=%s ratio=%.2f binance_gap=$%+.2f coinbase_gap=$%+.2f",
            direction,
            imbalance,
            ratio,
            binance_gap,
            coinbase_gap,
        )
        return TradeSignal("down", no_ask, direction, imbalance, ratio, binance_gap, coinbase_gap)

    logger.info(
        "!!! NO TRADE: divergence=%s binance_gap=$%+2f coinbase_gap=$%+2f but imbalance=%s ratio=%.2f",
        direction,
        binance_gap,
        coinbase_gap,
        imbalance,
        ratio
    )
    return None