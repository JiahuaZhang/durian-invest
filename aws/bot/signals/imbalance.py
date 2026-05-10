"""
Polymarket orderbook imbalance signal.

Computes bid/ask depth ratio on the top N price levels.
Bullish when ratio > 1.8, Bearish when ratio < 0.55.
"""

from __future__ import annotations

import logging

import requests

logger = logging.getLogger(__name__)

CLOB_API = 'https://clob.polymarket.com'


def fetch_orderbook(token_id: str) -> dict | None:
    """Fetch the full orderbook for a token from the CLOB API."""
    url = f"{CLOB_API}/book"
    params = {"token_id": token_id}
    try:
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f"Orderbook fetch failed: {e}")
        return None


def check_imbalance(
    book: dict,
    levels: int = 10,
    bullish_threshold: float = 1.8,
    bearish_threshold: float = 0.55,
) -> tuple[float, str | None]:
    """
    Check orderbook imbalance against thresholds.

    Returns:
        (ratio, direction)
        direction: "BULLISH", "BEARISH", or None
    """
    bids = book.get("bids", [])
    if len(bids) == 0:
        logger.warning("No bids found in orderbook")
        return None, None
    asks = book.get("asks", [])
    if len(asks) == 0:
        logger.warning("No asks found in orderbook")
        return None, None

    bid_depth = sum(float(b.get("size", 0)) for b in bids[-levels:])
    ask_depth = sum(float(a.get("size", 0)) for a in asks[-levels:])

    if ask_depth <= 0:
        ratio = float("inf")
    else:
        ratio = bid_depth / ask_depth

    direction = None
    if ratio >= bullish_threshold:
        direction = "BULLISH"
        logger.info(f"IMBALANCE BULLISH: ratio={ratio:.2f} bid_depth={bid_depth:.0f} ask_depth={ask_depth:.0f}")
    elif ratio <= bearish_threshold:
        direction = "BEARISH"
        logger.info(f"IMBALANCE BEARISH: ratio={ratio:.2f} bid_depth={bid_depth:.0f} ask_depth={ask_depth:.0f}")

    return ratio, direction
