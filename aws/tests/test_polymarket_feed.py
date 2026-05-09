from __future__ import annotations

from bot.feeds.polymarket import OrderBookCache


def test_orderbook_cache_applies_book_and_price_change():
    cache = OrderBookCache()
    cache.apply(
        {
            "event_type": "book",
            "asset_id": "up-token",
            "bids": [{"price": "0.47", "size": "10"}],
            "asks": [{"price": "0.49", "size": "5"}],
        }
    )
    cache.apply(
        {
            "event_type": "price_change",
            "price_changes": [
                {"asset_id": "up-token", "side": "BUY", "price": "0.48", "size": "20"},
                {"asset_id": "up-token", "side": "SELL", "price": "0.49", "size": "0"},
            ],
        }
    )

    book = cache.get_book("up-token")

    assert book["bids"][0] == {"price": "0.48", "size": "20"}
    assert book["asks"] == []
