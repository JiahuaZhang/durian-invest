"""
Price divergence signal: exchange average vs Chainlink.

The edge: Chainlink feed lags behind Binance/Coinbase by seconds.
When exchanges move >$50 but Chainlink hasn't updated, shares are mispriced.
"""

from __future__ import annotations

import logging
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