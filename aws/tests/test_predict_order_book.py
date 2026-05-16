import pytest
from bot.predict.order_book import PredictOrderBook

def test_predict_order_book_render_and_imbalance():
    # 1. Initialize
    book = PredictOrderBook(market_id=347806)

    # First update
    msg1 = {"type":"M","topic":"predictOrderbook/347806","data":{"asks":[[0.8,81.75],[0.84,100],[0.87,35],[0.89,102],[0.9,70],[0.92,112.25],[0.93,35]],"bids":[[0.77,10],[0.75,313.71],[0.74,100],[0.71,35],[0.69,35],[0.68,35],[0.67,98],[0.65,35],[0.61,126],[0.12,35],[0.02,75]],"lastOrderSettled":{"id":"198198432","kind":"LIMIT","marketId":347806,"outcome":"No","price":"0.80","side":"Bid"},"marketId":347806,"orderCount":20,"settlementsPending":{"asks":[],"bids":[]},"updateTimestampMs":1778974347572.0,"version":1}}

    # Second update
    msg2 = {"type":"M","topic":"predictOrderbook/347806","data":{"asks":[[0.8,71.75],[0.84,100],[0.87,35],[0.89,102],[0.9,35],[0.92,112.25],[0.93,35]],"bids":[[0.75,313.71],[0.74,100],[0.71,35],[0.69,35],[0.68,35],[0.67,98],[0.65,35],[0.61,126],[0.12,35],[0.02,75]],"lastOrderSettled":{"id":"198198432","kind":"LIMIT","marketId":347806,"outcome":"No","price":"0.80","side":"Bid"},"marketId":347806,"orderCount":17,"settlementsPending":{"asks":[],"bids":[]},"updateTimestampMs":1778974347762.0,"version":1}}

    # Third update
    msg3 = {"type":"M","topic":"predictOrderbook/347806","data":{"asks":[[0.8,71.75],[0.81,10],[0.84,100],[0.87,35],[0.9,70],[0.92,112.25],[0.93,35],[0.98,110.5]],"bids":[[0.78,10],[0.75,313.71],[0.74,100],[0.71,35],[0.7,100.7],[0.69,35],[0.68,35],[0.67,98],[0.65,35],[0.12,35],[0.02,75]],"lastOrderSettled":{"id":"198198432","kind":"LIMIT","marketId":347806,"outcome":"No","price":"0.80","side":"Bid"},"marketId":347806,"orderCount":20,"settlementsPending":{"asks":[],"bids":[]},"updateTimestampMs":1778974348116.0,"version":1}}

    print("\n--- UPDATE 1 ---")
    book.apply(msg1)
    book.render(level=5)
    print(f"Imbalance: {book.get_imbalance(level=5):.2f}")

    print("\n--- UPDATE 2 ---")
    book.apply(msg2)
    book.render(level=5)
    print(f"Imbalance: {book.get_imbalance(level=5):.2f}")

    print("\n--- UPDATE 3 ---")
    book.apply(msg3)
    book.render(level=5)
    print(f"Imbalance: {book.get_imbalance(level=5):.2f}")

# $env:PYTHONPATH="."; uv run pytest tests/test_predict_order_book.py -s -v
