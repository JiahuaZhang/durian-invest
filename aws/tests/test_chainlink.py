import asyncio
import logging

from bot.config import load_config
from bot.feeds.chainlink import ChainlinkFeed

# Configure logging to see the outputs clearly when running the test
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_chainlink_feed_live():
    """
    Real test that connects to Chainlink using config,
    polls for prices, and logs price updates for 3 seconds.
    """
    asyncio.run(_test_chainlink_feed_live())

async def _test_chainlink_feed_live():
    # 1. Load config (validate=False avoids needing full .env API keys just to test feeds)
    config = load_config(validate=False)
    
    updates_received = []

    # 2. Callback for each price update
    def on_update(source: str, price: float):
        logger.info(f"Received update from {source}: ${price:.2f}")
        updates_received.append(price)

    # 3. Initialize feed
    feed = ChainlinkFeed(
        feed_id=config.feeds.chainlink_feed_id,
        poll_seconds=config.feeds.chainlink_poll_seconds,
        on_update=on_update
    )

    # 4. Start the feed in a background task
    task = asyncio.create_task(feed.connect())
    
    # 5. Let it run for 3 seconds
    logger.info("Listening for Chainlink price updates for 3 seconds...")
    await asyncio.sleep(3)
    
    # 6. Stop the feed and wait for the task to exit
    logger.info("Stopping feed...")
    feed.stop()
    await task
    
    # 7. Assert we actually received data
    assert len(updates_received) > 0, "No price updates received from Chainlink within 3 seconds."
    logger.info(f"Test complete. Successfully received {len(updates_received)} updates in 3 seconds.")

# $env:PYTHONPATH="."; uv run pytest tests/test_chainlink.py -s -v --log-cli-level=INFO
