"""
CryptoOrderBook — local order book for Kalshi binary markets.

Maintains bid depth for both sides (YES / NO) and derives ask prices
using the binary-market identity:  yes_ask = 1 - best_no_bid.

Data flow:
    1. WS orderbook_snapshot → load_snapshot(msg)   (full reset)
    2. WS orderbook_delta    → apply_delta(msg)     (additive update)

Price representation:
    Internally prices are stored as integers in "deci-cents"
    (price_dollars * 10 000), so $0.9200 → 9200.  This avoids
    float-comparison issues and gives O(1) dict lookups.

Performance:
    Kalshi crypto markets have ~280 possible price levels (tapered
    tick structure).  All queries are O(n) with n tiny enough that
    plain dicts outperform sorted containers by a wide margin.
    A full snapshot load takes <0.1 ms; each delta <1 μs.
"""

from __future__ import annotations
from typing import Literal

Side = Literal["yes", "no"]

ZERO_EPS = 1e-9


def _to_int(price_str: str) -> int:
    """Dollar string → deci-cent integer.  '0.9200' → 9200."""
    return round(float(price_str) * 10_000)


def _to_dollars(price_int: int) -> float:
    """Deci-cent integer → dollar float.  9200 → 0.92."""
    return price_int / 10_000


class CryptoOrderBook:
    """Local L2 order book for one Kalshi binary market."""

    __slots__ = ("market_ticker", "market_id", "yes", "no", "seq", "_ready")

    def __init__(self) -> None:
        self.market_ticker: str = ""
        self.market_id: str = ""
        self.yes: dict[int, float] = {}   # YES bids — price_int → qty
        self.no: dict[int, float] = {}    # NO  bids — price_int → qty
        self.seq: int = 0
        self._ready: bool = False

    # ── State management ───────────────────────────────────────────

    @property
    def ready(self) -> bool:
        return self._ready

    def load_snapshot(self, msg: dict, seq: int = 0) -> None:
        """
        Replace the full book from an ``orderbook_snapshot`` message.

        ``msg`` shape::

            {
              "market_ticker": "KXBTC15M-...",
              "market_id": "uuid",
              "yes_dollars_fp": [["0.9200", "152.00"], ...],
              "no_dollars_fp":  [["0.0800", "600.00"], ...]
            }
        """
        self.market_ticker = msg.get("market_ticker", "")
        self.market_id = msg.get("market_id", "")
        self.seq = seq

        self.yes = _ingest_levels(msg.get("yes_dollars_fp", []))
        self.no = _ingest_levels(msg.get("no_dollars_fp", []))
        self._ready = True

    def apply_delta(self, msg: dict) -> None:
        """
        Apply one ``orderbook_delta`` message.  Delta is **additive**:
        new_qty = old_qty + delta.  If the result ≤ 0, the level is removed.

        ``msg`` shape::

            {
              "price_dollars": "0.3400",
              "delta_fp": "142.00",
              "side": "no",
              ...
            }
        """
        levels = self.yes if msg["side"] == "yes" else self.no
        price_int = _to_int(msg["price_dollars"])
        updated = levels.get(price_int, 0.0) + float(msg["delta_fp"])

        if updated <= ZERO_EPS:
            levels.pop(price_int, None)
        else:
            levels[price_int] = updated

    def clear(self) -> None:
        """Reset to empty / not-ready state (used on market rotation)."""
        self.yes.clear()
        self.no.clear()
        self.market_ticker = ""
        self.market_id = ""
        self.seq = 0
        self._ready = False

    # ── Top-of-book prices ─────────────────────────────────────────
    #
    #  In a binary market the two sides are complementary:
    #    Buying YES  ←→  matching against NO bids   →  yes_ask = 1 − best_no_bid
    #    Buying NO   ←→  matching against YES bids  →  no_ask  = 1 − best_yes_bid
    #

    @property
    def best_yes_bid(self) -> float:
        """Highest resting YES bid in dollars.  0 if empty."""
        return _to_dollars(max(self.yes)) if self.yes else 0.0

    @property
    def best_no_bid(self) -> float:
        """Highest resting NO bid in dollars.  0 if empty."""
        return _to_dollars(max(self.no)) if self.no else 0.0

    @property
    def yes_ask(self) -> float:
        """Price to BUY YES = 1 - best_no_bid.  1.0 when no NO bids."""
        return round(1.0 - _to_dollars(max(self.no)), 4) if self.no else 1.0

    @property
    def no_ask(self) -> float:
        """Price to BUY NO = 1 - best_yes_bid.  1.0 when no YES bids."""
        return round(1.0 - _to_dollars(max(self.yes)), 4) if self.yes else 1.0

    @property
    def yes_spread(self) -> float:
        return round(self.yes_ask - self.best_yes_bid, 4)

    @property
    def no_spread(self) -> float:
        return round(self.no_ask - self.best_no_bid, 4)

    # ── Depth queries ──────────────────────────────────────────────

    def depth_at(self, side: Side, price: float) -> float:
        """Resting bid quantity at an exact price level."""
        levels = self.yes if side == "yes" else self.no
        return levels.get(round(price * 10_000), 0.0)

    def bid_depth_above(self, side: Side, min_price: float) -> float:
        """Total bid contracts at or above *min_price*."""
        levels = self.yes if side == "yes" else self.no
        threshold = round(min_price * 10_000)
        return sum(q for p, q in levels.items() if p >= threshold)

    def ask_depth_up_to(self, side: Side, max_price: float) -> float:
        """
        Total contracts available to **buy** *side* at *max_price* or cheaper.

        For YES: sums NO bids at prices ≥ (1 - max_price).
        For NO:  sums YES bids at prices ≥ (1 - max_price).
        """
        opposite = self.no if side == "yes" else self.yes
        threshold = round((1.0 - max_price) * 10_000)
        return sum(q for p, q in opposite.items() if p >= threshold)

    # ── Ladders (for visualization / analysis) ─────────────────────

    def ask_ladder(self, side: Side, limit: int = 10) -> list[tuple[float, float]]:
        """
        Best *limit* ask levels as ``[(price, qty), ...]``, ascending.

        YES asks come from NO bids; NO asks from YES bids.
        """
        opposite = self.no if side == "yes" else self.yes
        top = sorted(opposite.items(), reverse=True)[:limit]
        return [(round(1.0 - p / 10_000, 4), q) for p, q in top]

    def bid_ladder(self, side: str, limit: int = 10) -> list[tuple[float, float]]:
        """Best *limit* bid levels as ``[(price, qty), ...]``, descending."""
        levels = self.yes if side == "yes" else self.no
        top = sorted(levels.items(), reverse=True)[:limit]
        return [(_to_dollars(p), q) for p, q in top]

    # ── Summary / debug ────────────────────────────────────────────

    def summary(self) -> dict:
        """Key metrics as a dict — handy for logging and notebooks."""
        return {
            "market_ticker": self.market_ticker,
            "yes_ask": self.yes_ask,
            "yes_bid": self.best_yes_bid,
            "yes_spread": self.yes_spread,
            "no_ask": self.no_ask,
            "no_bid": self.best_no_bid,
            "no_spread": self.no_spread,
            "yes_levels": len(self.yes),
            "no_levels": len(self.no),
        }

    def __repr__(self) -> str:
        if not self._ready:
            return "CryptoOrderBook(not ready)"
        return (
            f"CryptoOrderBook({self.market_ticker} "
            f"YES {self.best_yes_bid:.4f}/{self.yes_ask:.4f} "
            f"NO {self.best_no_bid:.4f}/{self.no_ask:.4f} "
            f"levels={len(self.yes)}+{len(self.no)})"
        )


# ── Module-level helpers ───────────────────────────────────────────

def _ingest_levels(entries: list[list[str]]) -> dict[int, float]:
    """Parse a ``[["0.92","152.00"], ...]`` snapshot list into {int: float}."""
    out: dict[int, float] = {}
    for price_str, qty_str in entries:
        qty = float(qty_str)
        if qty > ZERO_EPS:
            out[_to_int(price_str)] = qty
    return out
