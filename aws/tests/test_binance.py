import asyncio
import logging

from bot.config import load_config
from bot.feeds.binance import BinanceFeed

# Configure logging to see the outputs clearly when running the test
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_binance_feed_live():
    """
    Real test that connects to Binance using proxy config,
    subscribes, and logs price updates for 5 seconds.
    """
    asyncio.run(_test_binance_feed_live())

async def _test_binance_feed_live():
    # 1. Load config (validate=False avoids needing full .env API keys just to test feeds)
    config = load_config(validate=False)
    
    updates_received = []

    # 2. Callback for each price update
    def on_update(source: str, price: float):
        logger.info(f"Received update from {source}: ${price:.2f}")
        updates_received.append(price)

    # 3. Initialize feed
    feed = BinanceFeed(
        symbol=config.feeds.binance_symbol,
        proxy=config.httpx_proxy,
        on_update=on_update
    )

    # 4. Start the feed in a background task
    task = asyncio.create_task(feed.connect())
    
    # 5. Let it run for 3 seconds
    logger.info("Listening for Binance price updates for 3 seconds...")
    await asyncio.sleep(3)
    
    # 6. Stop the feed and wait for the task to exit
    logger.info("Stopping feed...")
    feed.stop()
    await task
    
    # 7. Assert we actually received data
    assert len(updates_received) > 0, "No price updates received from Binance within 5 seconds."
    logger.info(f"Test complete. Successfully received {len(updates_received)} updates in 5 seconds.")

# $env:PYTHONPATH="."; uv run pytest tests/test_binance.py -s -v --log-cli-level=INFO