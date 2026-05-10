import asyncio
import logging
import time

from bot.config import load_config
from bot.market_state import get_market_slug
from bot.markets import get_market_by_slug
from bot.feeds.polymarket_crypto_price import PolymarketCryptoPrice
from bot.feeds.binance import BinanceFeed
from bot.feeds.coinbase import CoinbaseFeed
from bot.feeds.chainlink import ChainlinkFeed
from bot.feeds.polymarket_market_channel import PolymarketMarketChannel
from bot.feeds.polymarket_state import PolymarketState

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_polymarket_state():
    """
    Live test of PolymarketState logic.
    Subscribes to all data feeds, pipes them into PolymarketState,
    and runs until a TradeSignal is generated or the market resolves.
    """
    asyncio.run(_test_polymarket_state())

async def _test_polymarket_state():
    config = load_config(validate=False)
    slug = get_market_slug(config.crypto, config.interval_minutes)
    
    logger.info(f"Generated slug: {slug}")
    
    # 1. Fetch market
    market = await asyncio.to_thread(get_market_by_slug, slug)
    if not market:
        logger.error(f"Market not found for slug {slug}")
        return
        
    logger.info(f"Targeting Market: {market.question} (ID: {market.up_token_id})")

    # 2. Fetch Open Price
    price_feed = PolymarketCryptoPrice()
    open_price = await price_feed.get_open_price(slug)
    logger.info(f"Open price for market: {open_price}")

    # 3. Setup PolymarketState instance
    # We spoof start_ts and end_ts so the state is immediately eligible for entries
    now = int(time.time())
    start_ts = now - config.timing.entry_start - 5
    end_ts = now + config.exit.hold_if_remaining + 300

    state = PolymarketState(
        cfg=config,
        market=market,
        asset=market.up_token_id,
        open_price=open_price,
        start_ts=start_ts,
        end_ts=end_ts
    )
    
    stop_event = asyncio.Event()

    # 4. Define callbacks routing to the state machine
    def on_price_update(source: str, price: float):
        signal = state.update_price(source, price)
        if signal:
            logger.info(f"=====================================================")
            logger.info(f"SIGNAL DETECTED via {source.capitalize()} trigger! \n{signal}")
            logger.info(f"=====================================================")
            stop_event.set()

    def on_polymarket(msg: dict):
        # Stop test if market naturally resolves
        if msg.get("event_type") == "market_resolved":
            logger.info(f"=====================================================")
            logger.info(f"Market resolved event received! \n{msg}")
            logger.info(f"=====================================================")
            stop_event.set()
            return
            
        # Forward orderbook events to state
        state.apply_market_message(msg)

    # 5. Initialize the raw data feeds
    binance = BinanceFeed(symbol="btcusdt", proxy=config.httpx_proxy, on_update=on_price_update)
    coinbase = CoinbaseFeed(product="BTC-USD", on_update=on_price_update)
    chainlink = ChainlinkFeed(on_update=on_price_update)
    
    poly_ws = PolymarketMarketChannel(on_message=on_polymarket)
    poly_ws.subscribe([market.up_token_id])
    
    # 6. Connect them all concurrently
    logger.info("Connecting to all websocket feeds concurrently...")
    tasks = [
        asyncio.create_task(binance.connect()),
        asyncio.create_task(coinbase.connect()),
        asyncio.create_task(chainlink.connect()),
        asyncio.create_task(poly_ws.connect())
    ]
    
    logger.info("Feeds live. Monitoring for signals or market resolution...")
    
    try:
        # We wait until the stop_event is fired by a signal or resolution.
        await asyncio.wait_for(stop_event.wait(), timeout=600.0)
    except asyncio.TimeoutError:
        logger.info("Test timeout reached (600s) without detecting a signal or resolution.")

    # 7. Graceful teardown
    logger.info("Stopping all feeds...")
    binance.stop()
    coinbase.stop()
    chainlink.stop()
    poly_ws.stop()
    
    for t in tasks:
        t.cancel()
        
    logger.info("Test complete.")

# $env:PYTHONPATH="."; uv run pytest tests/test_polymarket_state.py -s -v --log-cli-level=INFO
