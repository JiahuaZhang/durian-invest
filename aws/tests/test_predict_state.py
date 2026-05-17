import pytest
import logging
from bot.config import BotConfig
from bot.predict.state import PredictMarket, PredictState

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

def test_predict_state_integration():
    cfg = BotConfig()

    raw_market = {
        "id": 347806,
        "slug": "btc-updown-5m-1778974500",
        "conditionId": "0x123",
        "title": "Bitcoin Up or Down - May 16, 7:35PM-7:40PM ET",
        "question": "Bitcoin Up or Down - May 16, 7:35PM-7:40PM ET",
        "isNegRisk": False,
        "feeRateBps": 200,
        "outcomes": [
            {"side": "yes", "tokenId": "yes_token_123"},
            {"side": "no", "tokenId": "no_token_123"}
        ],
        "variantData": {
            "priceFeedProvider": "CHAINLINK",
            "startPrice": 75000.0,
            "endPrice": None
        }
    }

    market = PredictMarket.from_api(raw_market)
    assert market is not None
    assert market.id == 347806

    state = PredictState(cfg, market)
    
    # 1. Seed prices
    state.seed_prices(binance=75100.0, coinbase=75090.0, chainlink=75000.0)
    assert state.prices_ready is True

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
    
    changed = state.apply_message(msg)
    assert changed is True
    assert state.orderbook.best_bid == 7700
    assert state.orderbook.best_ask == 8000
    
    # 3. Simulate a manual chainlink update (bypassing WS)
    state.update_price("chainlink", 75050.0)
    assert state.chainlink_price == 75050.0

    print("\n--- STATE RENDER ---")
    state.render(level=3)

def test_predict_state_resolve():
    cfg = BotConfig()
    
    # Mock entry trade
    raw_market = {
        "id": 348531,
        "slug": "btc-updown-5m-1778979300",
        "outcomes": [
            {"name": "Up", "onChainId": "10654249"},
            {"name": "Down", "onChainId": "63799261"}
        ]
    }
    market = PredictMarket.from_api(raw_market)
    state = PredictState(cfg, market)
    
    from bot.signals.divergence import TradeSignal
    sig = TradeSignal(
        side="down", # token_index=1 -> "Down" -> onChainId 63799261
        source="binance",
        entry_price=0.20,
        bid_price=0.20,
        ask_price=0.22,
        open_price=70000.0,
        binance_price=70000.0,
        coinbase_price=70000.0,
        chainlink_price=70000.0,
        binance_gap=0.0,
        coinbase_gap=0.0,
        divergence=0.05,
        imbalance=0.1,
        imbalance_ratio=1.5
    )
    state.mark_trade(sig)
    
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
    
    res = state.resolve(resolved_payload)
    assert res.won is True
    assert res.winning_token_id == "63799261"
    assert res.exit_price == 1.0
    assert res.pnl_per_share == 0.8  # 1.0 - 0.20

# $env:PYTHONPATH="."; uv run pytest tests/test_predict_state.py -s -v
