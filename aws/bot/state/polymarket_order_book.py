from __future__ import annotations
import time
from typing import Any

def _to_int(price_str: str) -> int:
    """Dollar string → deci-cent integer.  '0.9200' → 9200."""
    return round(float(price_str) * 10_000)

def _to_dollars(price_int: int) -> float:
    """Deci-cent integer → dollar float.  9200 → 0.92."""
    return price_int / 10_000

class PolymarketOrderBook:
    """Independent OrderBook class using hash maps for fast updates."""
    
    __slots__ = ("asset_id", "side", "bids", "asks", "best_bid", "best_ask", "last_update")
    
    def __init__(self, asset_id: str | None = None, side: str = "Yes"):
        self.asset_id = asset_id
        self.side = side
        self.bids: dict[int, float] = {}
        self.asks: dict[int, float] = {}
        self.best_bid: int = 0
        self.best_ask: int = 0
        self.last_update: float = 0.0

    def apply(self, message: dict[str, Any]) -> None:
        event_type = message.get("event_type")
        if event_type == "book":
            self.apply_book(message)
        elif event_type == "price_change":
            self.apply_price_change(message)

    def apply_book(self, message: dict[str, Any]) -> None:
        if message.get("asset_id") != self.asset_id:
            return

        self.bids.clear()
        for bid in message.get("bids", []):
            self.bids[_to_int(bid.get("price"))] = float(bid.get("size", 0))

        self.asks.clear()
        for ask in message.get("asks", []):
            self.asks[_to_int(ask.get("price"))] = float(ask.get("size", 0))

        self.best_bid = max(self.bids.keys()) if self.bids else 0
        self.best_ask = min(self.asks.keys()) if self.asks else 0

        self.last_update = time.monotonic()

    def apply_price_change(self, message: dict[str, Any]) -> None:
        changes = message.get("price_changes", [])
        for change in changes:
            if change.get("asset_id") != self.asset_id:
                continue

            side = change.get("side")
            price_str = change.get("price")
            if price_str is None:
                continue
            
            try:
                price_int = _to_int(price_str)
                size = float(change.get("size"))
            except (TypeError, ValueError):
                continue

            if side == "BUY":
                if size <= 0:
                    self.bids.pop(price_int, None)
                else:
                    self.bids[price_int] = size
            elif side == "SELL":
                if size <= 0:
                    self.asks.pop(price_int, None)
                else:
                    self.asks[price_int] = size

            self.best_bid = _to_int(change.get("best_bid"))
            self.best_ask = _to_int(change.get("best_ask"))

        self.last_update = time.monotonic()

    def get_book(self) -> dict[str, list[dict[str, str]]]:
        bids = sorted(
            [{"price": str(_to_dollars(p)), "size": str(s)} for p, s in self.bids.items()],
            key=lambda x: float(x["price"]),
            reverse=True
        )
        asks = sorted(
            [{"price": str(_to_dollars(p)), "size": str(s)} for p, s in self.asks.items()],
            key=lambda x: float(x["price"])
        )
        return {"bids": bids, "asks": asks}

    def get_price(self) -> dict[str, dict[str, float]]:
        """Return the best bid and ask prices for both sides."""
        yes_bid = _to_dollars(self.best_bid) if self.best_bid else 0.0
        yes_ask = _to_dollars(self.best_ask) if self.best_ask else 0.0
        
        no_bid = round(1.0 - yes_ask, 4) if yes_ask > 0 else 0.0
        no_ask = round(1.0 - yes_bid, 4) if yes_bid > 0 else 0.0
        
        return {
            "yes": {"bid": yes_bid, "ask": yes_ask},
            "no": {"bid": no_bid, "ask": no_ask}
        }

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
            left = f"{prefix}   {p_str:<11}"
            print(f"{left}| {size:>14,.2f}")

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
            left = f"{prefix}   {p_str:<11}"
            print(f"{left}| {size:>14,.2f}")

        print("=======================================")

    def get_imbalance(self, level: int = 10) -> float:
        best_bids = sorted(self.bids.items(), key=lambda x: x[0], reverse=True)[:level]
        best_asks = sorted(self.asks.items(), key=lambda x: x[0])[:level]

        bid_depth = sum(size for _, size in best_bids)
        ask_depth = sum(size for _, size in best_asks)

        if ask_depth == 0:
            return float('inf') if bid_depth > 0 else 1.0

        return bid_depth / ask_depth
