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

    # ── Imbalance / conviction metrics ─────────────────────────────

    def dollar_volume(self, side: Side) -> float:
        """
        Sum of price * qty across all bids for one side.
        Represents total dollar commitment — a $0.95 bid for 100 contracts
        counts 20x more than a $0.05 bid for 100 contracts.
        """
        levels = self.yes if side == "yes" else self.no
        return sum(p * q for p, q in levels.items()) / 10_000

    def dollar_weighted_imbalance(self) -> float:
        """
        Full-book dollar-weighted imbalance.

        Returns -1.0 (all NO) to +1.0 (all YES).  Near 0 = balanced.
        """
        yes_vol = self.dollar_volume("yes")
        no_vol = self.dollar_volume("no")
        total = yes_vol + no_vol
        if total < ZERO_EPS:
            return 0.0
        return (yes_vol - no_vol) / total

    def contract_imbalance(self) -> float:
        """
        Raw contract-count imbalance (no price weighting).

        Returns -1.0 (all NO) to +1.0 (all YES).
        Price-neutral: a 100-contract YES bid at $0.05 counts the same
        as a 100-contract NO bid at $0.95.
        """
        yes_qty = sum(self.yes.values())
        no_qty = sum(self.no.values())
        total = yes_qty + no_qty
        if total < ZERO_EPS:
            return 0.0
        return (yes_qty - no_qty) / total

    def top_book_imbalance(self, depth: float = 0.05) -> float:
        """
        Contract imbalance near each side's own best bid.

        Compares depth within *depth* dollars of each side's best bid.
        Fully price-neutral — each side is measured relative to its own
        top-of-book, so the current market price doesn't bias the result.

        Returns -1.0 (all NO) to +1.0 (all YES).
        """
        if not self.yes or not self.no:
            return 0.0
        d = round(depth * 10_000)

        yes_top = max(self.yes)
        yes_floor = yes_top - d
        yes_near = sum(q for p, q in self.yes.items() if p >= yes_floor)

        no_top = max(self.no)
        no_floor = no_top - d
        no_near = sum(q for p, q in self.no.items() if p >= no_floor)

        total = yes_near + no_near
        if total < ZERO_EPS:
            return 0.0
        return (yes_near - no_near) / total

    def normalized_dollar_imbalance(self) -> float:
        """
        Dollar volume normalized by best bid price.

        Divides each side's dollar_volume by its best bid, converting to
        "equivalent contracts at top-of-book".  Removes the inherent bias
        where the higher-priced side always dominates raw dollar volume.

        Returns -1.0 (all NO) to +1.0 (all YES).
        """
        yes_bid = self.best_yes_bid
        no_bid = self.best_no_bid
        if yes_bid < ZERO_EPS or no_bid < ZERO_EPS:
            return 0.0
        yes_norm = self.dollar_volume("yes") / yes_bid
        no_norm = self.dollar_volume("no") / no_bid
        total = yes_norm + no_norm
        if total < ZERO_EPS:
            return 0.0
        return (yes_norm - no_norm) / total

    def best_bid_imbalance(self) -> float:
        """
        Top-of-book imbalance: best_yes_bid - (1 - best_no_bid).

        Positive = YES-side pressure, negative = NO-side pressure.
        When both sides have perfect balance, this is 0.
        """
        return round(self.best_yes_bid - (1.0 - self.best_no_bid), 4)

    def is_stable(self, max_spread: float = 0.05) -> bool:
        """True when both yes and no spreads are at or below *max_spread*."""
        return self.yes_spread <= max_spread and self.no_spread <= max_spread

    def get_stats(self, ts: str) -> dict:
        return {
            'time': ts,
            'dollar_weighted_imbalance': self.dollar_weighted_imbalance(),
            'contract_imbalance': self.contract_imbalance(),
            'top_book_imbalance': self.top_book_imbalance(),
            'normalized_dollar_imbalance': self.normalized_dollar_imbalance(),
            'best_bid_imbalance': self.best_bid_imbalance(),
            'yes_spread': self.yes_spread,
            'no_spread': self.no_spread,
            'yes_bid': self.best_yes_bid,
            'no_bid': self.best_no_bid,
            'yes_ask': self.yes_ask,
            'no_ask': self.no_ask,
            'yes_volume': self.dollar_volume('yes'),
            'no_volume': self.dollar_volume('no'),
            'yes_levels': len(self.yes),
        }

    def imbalance_log(self, ts: str = None) -> str:
        ci = self.contract_imbalance()
        tb = self.top_book_imbalance()
        nd = self.normalized_dollar_imbalance()
        bb = self.best_bid_imbalance()
        sentiment = "YES" if ci > 0 and tb > 0 and nd > 0 else "NO" if ci < 0 and tb < 0 and nd < 0 else "MIXED"
        return (
            f"[{self.market_ticker}] @{ts}  sentiment={sentiment} "
            f"contract_imb={ci:+.4f} top_book_imb={tb:+.4f} norm_dollar_imb={nd:+.4f} best_bid_imb={bb:+.4f} "
            f"dollar_weighted_imb={self.dollar_weighted_imbalance():+.4f} yes_vol=${self.dollar_volume('yes'):.2f} no_vol=${self.dollar_volume('no'):.2f} "
            f"yes={self.best_yes_bid:.4f}/{self.yes_ask:.4f}({self.yes_spread:.4f}) "
            f"no={self.best_no_bid:.4f}/{self.no_ask:.4f}({self.no_spread:.4f}) "
        )

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
            "contract_imbalance": round(self.contract_imbalance(), 4),
            "top_book_imbalance": round(self.top_book_imbalance(), 4),
            "normalized_dollar_imbalance": round(self.normalized_dollar_imbalance(), 4),
            "best_bid_imbalance": self.best_bid_imbalance(),
            "yes_dollar_volume": round(self.dollar_volume("yes"), 2),
            "no_dollar_volume": round(self.dollar_volume("no"), 2),
            "stable": self.is_stable(),
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
