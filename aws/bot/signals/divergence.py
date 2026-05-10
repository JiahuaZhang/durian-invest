"""
Price divergence signal: exchange average vs Chainlink.

The edge: Chainlink feed lags behind Binance/Coinbase by seconds.
When exchanges move >$50 but Chainlink hasn't updated, shares are mispriced.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def check_divergence(
    binance_price: float,
    coinbase_price: float,
    chainlink_price: float,
    threshold: float = 50.0,
) -> str | None:
    """
    Detect price divergence between exchange average and Chainlink.

    Returns:
        "UP"   — exchanges are above Chainlink by >= threshold (BTC moving up)
        "DOWN" — exchanges are below Chainlink by >= threshold (BTC moving down)
        None   — no significant divergence
    """
    binance_delta = binance_price - chainlink_price
    coinbase_delta = coinbase_price - chainlink_price

    exchanges_agree = (
        (binance_delta > threshold and coinbase_delta > threshold) 
        or (binance_delta < -threshold and coinbase_delta < -threshold)
    )

    if not exchanges_agree:
        return None

    direction = "UP" if binance_delta > threshold else "DOWN"
    logger.info(
        f"DIVERGENCE DETECTED: {direction}: chainlink={chainlink_price:.2f} "
        f"binance={binance_price:.2f} binance_delta={binance_delta:+.2f} "
        f"coinbase={coinbase_price:.2f} coinbase_delta={coinbase_delta:+.2f}"
        # f"now_ts={now_ts}"
    )
    return direction