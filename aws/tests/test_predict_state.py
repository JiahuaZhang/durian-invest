import pytest
import logging
import time
from bot.config import BotConfig
from bot.predict.state import PredictState, Trade, OrderRecord
from bot.predict.client import PredictClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

@pytest.mark.asyncio
async def test_predict_state_integration():
    cfg = BotConfig()
    client = PredictClient(cfg)

    raw_market = {
        "id": 347806,
        "categorySlug": "btc-updown-5m-1778974500",
        "title": "Bitcoin Up or Down - May 16, 7:35PM-7:40PM ET",
        "outcomes": [
            {"name": "Up", "onChainId": "10654249"},
            {"name": "Down", "onChainId": "63799261"}
        ],
        "variantData": {
            "priceFeedProvider": "CHAINLINK",
            "startPrice": 75000.0,
        }
    }

    state = PredictState(cfg, client, raw_market)
    assert state.market_id == 347806

    # 1. Seed prices
    state.update("binance", 75100.0)
    state.update("coinbase", 75090.0)
    state.update("chainlink", 75000.0)
    assert state.binance_price == 75100.0
    assert state.coinbase_price == 75090.0
    assert state.chainlink_price == 75000.0

    # 2. Apply orderbook payload
    msg = {
        "type": "M",
        "topic": "predictOrderbook/347806",
        "data": {
            "asks": [[0.8, 81.75], [0.84, 100]],
            "bids": [[0.77, 10], [0.75, 313.71]],
            "marketId": 347806
        }
    }
    
    state.update("orderbook", msg)
    assert state.orderbook.best_bid == 7700
    assert state.orderbook.best_ask == 8000
    
    # 3. Simulate a manual chainlink update
    state.update("chainlink", 75050.0)
    assert state.chainlink_price == 75050.0

def test_predict_state_resolve():
    cfg = BotConfig()
    client = PredictClient(cfg)
    
    # Mock entry trade
    raw_market = {
        "id": 348531,
        "categorySlug": "btc-updown-5m-1778979300",
        "outcomes": [
            {"name": "Up", "onChainId": "10654249"},
            {"name": "Down", "onChainId": "63799261"}
        ],
        "variantData": {
            "startPrice": 70000.0,
        }
    }
    state = PredictState(cfg, client, raw_market)
    
    trade = Trade(
        outcome="Down",
        entry_price=0.20,
        enter=OrderRecord(signal=None, start=time.time(), filled=time.time()),
        amount=100
    )
    state.trades.append(trade)
    
    # Resolution payload
    resolved_payload = {
        "id": 348531,
        "status": "RESOLVED",
        "resolution": {
            "name": "Down",
            "onChainId": "63799261",
            "status": "WON"
        }
    }
    
    state.resolve(resolved_payload)
    
    assert trade.exit_price == 1.0
    assert trade.pnl == 0.8  # 1.0 - 0.20
# $env:PYTHONPATH="."; uv run pytest tests/test_predict_state.py -s -v
