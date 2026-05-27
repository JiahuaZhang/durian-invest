"""
predict.fun orderbook — full-snapshot variant of polymarket_order_book.

Predict.fun's WebSocket pushes a complete `{asks, bids}` snapshot on every
update via the `predictOrderbook/{marketId}` topic. There are no incremental
diff messages, so we just clear and rebuild each side on every payload.

Prices arrive as numbers (already in dollars), and the book is keyed on the
``Yes`` outcome — ``No`` is computed as ``1 - yes`` exactly like Polymarket.
The public API (`get_book` / `get_price` / `render` / `get_imbalance`) is
intentionally identical so downstream code (signals, manager) can treat both
order books interchangeably.
"""

from __future__ import annotations

import time
from typing import Any


def _to_int(price: float) -> int:
    """Dollar value → deci-cent integer (e.g. 0.92 → 9200) for fast key lookup."""
    return round(price * 10_000)


def _to_dollars(price_int: int) -> float:
    return price_int / 10_000


class PredictOrderBook:
    """Single-market predict.fun orderbook with the same shape as PolymarketOrderBook."""

    __slots__ = ("market_id", "side", "bids", "asks", "best_bid", "best_ask", "last_update")

    def __init__(self, market_id: int | None = None, side: str = "Yes"):
        self.market_id = market_id
        self.side = side
        self.bids: dict[int, float] = {}
        self.asks: dict[int, float] = {}
        self.best_bid: int = 0
        self.best_ask: int = 0
        self.last_update: float = 0.0

    def apply(self, payload: dict[str, Any]) -> None:
        """Apply a `predictOrderbook/{id}` payload.

        Payload shape (per https://dev.predict.fun docs):
            {
              "type": "M",
              "topic": "predictOrderbook/...",
              "data": {
                  "marketId": int,
                  "updateTimestampMs": int,
                  "lastOrderSettled": {...} | null,
                  "asks": [[price, size], ...],
                  "bids": [[price, size], ...]
              }
            }
        """
        data = payload.get("data")

        if data["marketId"] != self.market_id:
            raise ValueError(f"Market ID mismatch: {data['marketId']} != {self.market_id}")

        self.bids.clear()
        for entry in data.get("bids"):
            price_int, size = _parse_level(entry)
            self.bids[price_int] = size

        self.asks.clear()
        for entry in data.get("asks"):
            price_int, size = _parse_level(entry)
            self.asks[price_int] = size

        self.best_bid = max(self.bids.keys()) if self.bids else 0
        self.best_ask = min(self.asks.keys()) if self.asks else 0
        self.last_update = time.monotonic()

    def get_book(self) -> dict[str, list[dict[str, str]]]:
        bids = sorted(
            [{"price": str(_to_dollars(p)), "size": str(s)} for p, s in self.bids.items()],
            key=lambda x: float(x["price"]),
            reverse=True,
        )
        asks = sorted(
            [{"price": str(_to_dollars(p)), "size": str(s)} for p, s in self.asks.items()],
            key=lambda x: float(x["price"]),
        )
        return {"bids": bids, "asks": asks}

    def get_price(self) -> dict[str, dict[str, float]]:
        """Best bid and ask for both Yes and No sides."""
        yes_bid = _to_dollars(self.best_bid) if self.best_bid else 0.0
        yes_ask = _to_dollars(self.best_ask) if self.best_ask else 0.0

        no_bid = round(1.0 - yes_ask, 4) if yes_ask > 0 else 0.0
        no_ask = round(1.0 - yes_bid, 4) if yes_bid > 0 else 0.0

        return {
            "yes": {"bid": yes_bid, "ask": yes_ask},
            "no": {"bid": no_bid, "ask": no_ask},
        }

    def is_ready(self) -> bool:
        return self.best_bid > 0 and self.best_ask > 0 and self.best_ask > self.best_bid

    def render(self, level: int = 10) -> None:
        best_bids = sorted(self.bids.items(), key=lambda x: x[0], reverse=True)[:level]
        best_asks = sorted(self.asks.items(), key=lambda x: x[0])[:level]
        best_asks_desc = sorted(best_asks, key=lambda x: x[0], reverse=True)

        print("=======================================")
        print("      Price      |      Size")
        print("---------------------------------------")
        print(" [ASKS / SELLERS]")
        for i, (p_int, size) in enumerate(best_asks_desc):
            p_str = f"${_to_dollars(p_int):.2f}"
            prefix = " ->" if i == len(best_asks_desc) - 1 else "   "
            print(f"{prefix}   {p_str:<11}| {size:>14,.2f}")

        print("---------------------------------------")
        if self.best_bid and self.best_ask:
            spread = _to_dollars(self.best_ask - self.best_bid)
            print(f"                           SPREAD: ${spread:.2f}")
        else:
            print("                           SPREAD: N/A")
        print("---------------------------------------")
        print(" [BIDS / BUYERS]")
        for i, (p_int, size) in enumerate(best_bids):
            p_str = f"${_to_dollars(p_int):.2f}"
            prefix = " ->" if i == 0 else "   "
            print(f"{prefix}   {p_str:<11}| {size:>14,.2f}")

        print("=======================================")

    def get_imbalance(self, level: int = 10) -> float:
        best_bids = sorted(self.bids.items(), key=lambda x: x[0], reverse=True)[:level]
        best_asks = sorted(self.asks.items(), key=lambda x: x[0])[:level]
        bid_depth = sum(size for _, size in best_bids)
        ask_depth = sum(size for _, size in best_asks)
        if ask_depth == 0:
            return float("inf") if bid_depth > 0 else 1.0
        return bid_depth / ask_depth


def _parse_level(entry: Any) -> tuple[int, float] | None:
    """Parse one `[price, size]` book level. Returns None for malformed/zero entries."""
    return _to_int(entry[0]), entry[1]
