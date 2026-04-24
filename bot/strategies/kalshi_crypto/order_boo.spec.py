from strategies.kalshi_crypto.crypto_order_book import CryptoOrderBook
from strategies.kalshi_crypto.market_state import get_current_15m_market_ticker
import json, time

ticker, close_time = get_current_15m_market_ticker("KXBTC15M")
book = CryptoOrderBook()
print(f"Market: {ticker}  (close_time unix={close_time})")
print(f"Book:   {book}")

async with client.connect_ws() as ws:
    await client.ws_subscribe(ws, ["orderbook_delta"], market_ticker=ticker, send_initial_snapshot=True)
    print("✓ Connected & subscribed to orderbook_delta\n")

    count = 0
    t0 = time.perf_counter()
    async for raw in ws:
        data = json.loads(raw)
        msg_type = data.get("type")

        if msg_type == "orderbook_snapshot":
            book.load_snapshot(data["msg"], seq=data.get("seq", 0))
            print(f"[snapshot] {book}")
            print(f"  YES top-5 bids: {book.bid_ladder('yes', 5)}")
            print(f"  YES top-5 asks: {book.ask_ladder('yes', 5)}")
            print(f"  NO  top-5 bids: {book.bid_ladder('no', 5)}")
            print(f"  depth to buy YES ≤$0.92: {book.ask_depth_up_to('yes', 0.92):.2f} contracts")
            print()

        elif msg_type == "orderbook_delta":
            book.apply_delta(data["msg"])
            count += 1
            if count % 50 == 0:
                elapsed = (time.perf_counter() - t0) * 1000
                print(f"  [{count} deltas, {elapsed:.1f}ms total] {book}")

        elif msg_type == "subscribed":
            print(f"[subscribed] sid={data['msg']['sid']}")

        if count >= 200:
            break

elapsed = (time.perf_counter() - t0) * 1000
print(f"\n✓ Processed {count} deltas in {elapsed:.1f}ms ({elapsed/max(count,1):.3f}ms/delta)")
print(f"Final: {book}")
print(book.summary())

# Unit test — verify snapshot + delta with known data (no WS needed)
from strategies.kalshi_crypto.crypto_order_book import CryptoOrderBook

b = CryptoOrderBook()
assert not b.ready
assert repr(b) == "CryptoOrderBook(not ready)"

# Minimal snapshot
b.load_snapshot({
    "market_ticker": "TEST-MARKET",
    "market_id": "abc-123",
    "yes_dollars_fp": [
        ["0.9200", "100.00"],
        ["0.9500", "50.00"],
        ["0.8800", "200.00"],
    ],
    "no_dollars_fp": [
        ["0.0100", "300.00"],
        ["0.0300", "150.00"],
    ],
})

assert b.ready
assert b.best_yes_bid == 0.95        # max of 0.92, 0.95, 0.88
assert b.best_no_bid == 0.03         # max of 0.01, 0.03
assert b.yes_ask == round(1.0 - 0.03, 4)  # = 0.97
assert b.no_ask == round(1.0 - 0.95, 4)   # = 0.05
assert b.depth_at("yes", 0.92) == 100.0
assert b.depth_at("yes", 0.50) == 0.0     # no level here

# Delta: add 25 contracts to YES at $0.92
b.apply_delta({"side": "yes", "price_dollars": "0.92", "delta_fp": "25.00"})
assert b.depth_at("yes", 0.92) == 125.0

# Delta: remove the entire YES $0.95 level
b.apply_delta({"side": "yes", "price_dollars": "0.95", "delta_fp": "-50.00"})
assert b.depth_at("yes", 0.95) == 0.0
assert b.best_yes_bid == 0.92   # $0.95 gone, next best is $0.92
assert b.no_ask == round(1.0 - 0.92, 4)  # = 0.08

# ask_depth_up_to: buying YES at $0.97 or cheaper → NO bids at ≥ $0.03
assert b.ask_depth_up_to("yes", 0.97) == 150.0  # only the $0.03 level

# Ladders
asks = b.ask_ladder("yes", 5)
assert asks[0][0] == 0.97   # cheapest YES ask = 1 - 0.03
bids = b.bid_ladder("yes", 5)
assert bids[0][0] == 0.92   # best YES bid

# Clear
b.clear()
assert not b.ready
assert len(b.yes) == 0

print("✓ All assertions passed")