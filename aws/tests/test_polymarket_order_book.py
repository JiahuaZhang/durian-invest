import asyncio
import logging

from bot.config import load_config
from bot.markets import get_market_by_slug
from bot.market_state import get_market_slug
from bot.feeds.polymarket_market_channel import PolymarketMarketChannel
from bot.state.polymarket_order_book import PolymarketOrderBook

# Configure logging to see the outputs clearly when running the test
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_polymarket_order_book():
    """
    Real test that connects to Polymarket WS, subscribes to the current market's
    'Yes' token, and renders the live order book changes.
    """
    asyncio.run(_test_polymarket_order_book())

async def _test_polymarket_order_book():
    # 1. Load config and get active market slug
    config = load_config(validate=False)
    slug = get_market_slug(config.crypto, config.interval_minutes)
    
    logger.info(f"Generated slug: {slug}")
    logger.info("Fetching market data...")
    
    # 2. get_market_by_slug is synchronous and hits the API, so we run it in a thread
    market = await asyncio.to_thread(get_market_by_slug, slug)
    
    if not market:
        logger.error(f"Failed to fetch market for slug {slug}.")
        return
        
    logger.info(f"Targeting Market: {market.question} (Token ID: {market.up_token_id})")

    # 3. Setup the OrderBook and Channel
    ob = PolymarketOrderBook(asset_id=market.up_token_id, side="Yes")
    snapshot_received = False
    market_resolved_msg = None
    
    def on_message(msg):
        nonlocal snapshot_received, market_resolved_msg
        
        # Track market resolution
        if msg.get("event_type") == "market_resolved":
            market_resolved_msg = msg
            
        ob.apply(msg)
        
        # Detect when the initial snapshot arrives (bids/asks will be populated)
        if not snapshot_received and ob.bids and ob.asks:
            snapshot_received = True

    channel = PolymarketMarketChannel(on_message=on_message)
    channel.subscribe([market.up_token_id])
    
    # 4. Start the background connection task
    task = asyncio.create_task(channel.connect())
    
    logger.info("Waiting for initial order book snapshot...")
    
    # 5. Wait until the snapshot populates the order book
    while not snapshot_received:
        await asyncio.sleep(0.1)
        
    # 6. Render the initial state
    print("\n\n>>> INITIAL RENDER:")
    ob.render(level=10)
    logger.info(f"Initial imbalance: {ob.get_imbalance()}")
    
    # 7. Wait 1 second and render the updated book, repeating 3 times
    for i in range(1, 4):
        await asyncio.sleep(1.0)
        print(f"\n\n>>> RENDER AFTER {i} SECOND(S) OF UPDATES:")
        ob.render(level=10)
        logger.info(f"After {i} second(s), imbalance: {ob.get_imbalance()}")

    logger.info("Monitoring stream for 'market_resolved' event. This will block until the market actually resolves...")
    
    # Wait until the market resolves
    while not market_resolved_msg:
        await asyncio.sleep(5)
        
    logger.info("=========================================")
    logger.info("MARKET RESOLVED EVENT RECEIVED!")
    logger.info(f"Actual Message: {market_resolved_msg}")
    logger.info("=========================================")

    # 8. Clean up
    logger.info("Stopping Polymarket WS channel...")
    channel.stop()
    await task
    
    logger.info("Test complete.")

# $env:PYTHONPATH="."; uv run pytest tests/test_polymarket_order_book.py -s -v --log-cli-level=INFO
