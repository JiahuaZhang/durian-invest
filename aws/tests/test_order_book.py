import json

from bot.state.polymarket_order_book import PolymarketOrderBook, _to_dollars

def test_order_book():
    data = json.loads("""[{"market":"0x1587ee233e3c926209cc5c4f888f34c96c9c7f7c1448d17989d3b7a79c1cdf32","asset_id":"99267005274969015530704549459879765455779440435684795967857484533170446088617","timestamp":"1778204225247","hash":"8602e06a586270fe564ae1969742523adbcbd043","bids":[{"price":"0.01","size":"12816.02"},{"price":"0.02","size":"1350.6"},{"price":"0.03","size":"1107"},{"price":"0.04","size":"272"},{"price":"0.05","size":"519.99"},{"price":"0.06","size":"1081"},{"price":"0.07","size":"271.78"},{"price":"0.08","size":"305.9"},{"price":"0.09","size":"203.55"},{"price":"0.1","size":"285.68"},{"price":"0.11","size":"851.6"},{"price":"0.12","size":"460.32"},{"price":"0.13","size":"127.02"},{"price":"0.14","size":"83.24"}],"asks":[{"price":"0.99","size":"11570.96"},{"price":"0.98","size":"844.71"},{"price":"0.97","size":"750.7"},{"price":"0.96","size":"320.8"},{"price":"0.95","size":"689.98"},{"price":"0.94","size":"288.8"},{"price":"0.93","size":"409.15"},{"price":"0.92","size":"386.9"},{"price":"0.91","size":"399.55"},{"price":"0.9","size":"153"},{"price":"0.89","size":"146.79"},{"price":"0.88","size":"155.4"},{"price":"0.87","size":"131.8"},{"price":"0.86","size":"229.9"},{"price":"0.85","size":"158.2"},{"price":"0.84","size":"96.8"},{"price":"0.83","size":"101.5"},{"price":"0.82","size":"94.4"},{"price":"0.81","size":"193.4"},{"price":"0.8","size":"151.1"},{"price":"0.79","size":"91.7"},{"price":"0.78","size":"91"},{"price":"0.77","size":"90.3"},{"price":"0.76","size":"189.7"},{"price":"0.75","size":"97.68"},{"price":"0.74","size":"88.7"},{"price":"0.73","size":"88.3"},{"price":"0.72","size":"87.89"},{"price":"0.71","size":"187.5"},{"price":"0.7","size":"87.1"},{"price":"0.69","size":"91.8"},{"price":"0.68","size":"86.5"},{"price":"0.67","size":"93.3"},{"price":"0.66","size":"191.2"},{"price":"0.65","size":"85.8"},{"price":"0.64","size":"85.6"},{"price":"0.63","size":"85.4"},{"price":"0.62","size":"105.69"},{"price":"0.61","size":"190.1"},{"price":"0.6","size":"126.35"},{"price":"0.59","size":"89.9"},{"price":"0.58","size":"89.8"},{"price":"0.57","size":"94.7"},{"price":"0.56","size":"184.6"},{"price":"0.55","size":"114.5"},{"price":"0.54","size":"106.97"},{"price":"0.53","size":"84.5"},{"price":"0.52","size":"104.4"},{"price":"0.51","size":"232.4"},{"price":"0.5","size":"10179.41"},{"price":"0.49","size":"197.5"},{"price":"0.48","size":"70"},{"price":"0.47","size":"70"},{"price":"0.46","size":"185.33"},{"price":"0.45","size":"123.54"},{"price":"0.44","size":"50"},{"price":"0.43","size":"250"},{"price":"0.42","size":"50"},{"price":"0.41","size":"150"},{"price":"0.4","size":"75"},{"price":"0.39","size":"150"},{"price":"0.38","size":"418.3"},{"price":"0.37","size":"245.69"},{"price":"0.36","size":"301.8"},{"price":"0.35","size":"209.37"},{"price":"0.34","size":"562.56"},{"price":"0.33","size":"759.63"},{"price":"0.32","size":"386.85"},{"price":"0.31","size":"266.8"},{"price":"0.3","size":"219.45"},{"price":"0.29","size":"172.5"},{"price":"0.28","size":"177.21"},{"price":"0.27","size":"483.3"},{"price":"0.26","size":"278.7"},{"price":"0.25","size":"249.98"},{"price":"0.24","size":"179.7"},{"price":"0.23","size":"905.95"},{"price":"0.22","size":"813"},{"price":"0.21","size":"896.7"},{"price":"0.2","size":"898.5"},{"price":"0.19","size":"823.42"},{"price":"0.18","size":"886.42"},{"price":"0.17","size":"219.35"},{"price":"0.16","size":"725.62"},{"price":"0.15","size":"473.32"}],"tick_size":"0.01","event_type":"book","last_trade_price":"0.850"}]""")
    
    update_data = json.loads("""{"market":"0x1587ee233e3c926209cc5c4f888f34c96c9c7f7c1448d17989d3b7a79c1cdf32", "price_changes":[{"asset_id":"99462914632141937595531009504605881366011777350891552031161949202493530543388", "price":"0.85", "size":"503.32", "side":"BUY", "hash":"52a1ab0b83926e8d34a1018feea85a50af0cea81", "best_bid":"0.85", "best_ask":"0.86"}, {"asset_id":"99267005274969015530704549459879765455779440435684795967857484533170446088617", "price":"0.15", "size":"503.32", "side":"SELL", "hash":"4e761e84f74fbbd20f0787409962cfa66221ddc4", "best_bid":"0.14", "best_ask":"0.15"}], "timestamp":"1778204225252", "event_type":"price_change"}""")
    
    asset_id = "99267005274969015530704549459879765455779440435684795967857484533170446088617"
    book = PolymarketOrderBook(asset_id=asset_id)
    book.apply(data[0])

    print("Initial render:")
    book.render(10)
    print(f"Imbalance (10): {book.get_imbalance(10):.4f}")
    print(f"Best Bid: ${_to_dollars(book.best_bid):.2f} | Best Ask: ${_to_dollars(book.best_ask):.2f}\n")

    book.apply(update_data)

    print("After price change:")
    book.render(10)
    print(f"Imbalance (10): {book.get_imbalance(10):.4f}")
    print(f"Best Bid: ${_to_dollars(book.best_bid):.2f} | Best Ask: ${_to_dollars(book.best_ask):.2f}\n")

if __name__ == "__main__":
    test_order_book()

# $env:PYTHONPATH="."; uv run python tests/test_order_book.py