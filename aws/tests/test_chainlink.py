import asyncio
import logging
import os
import ctypes

from bot.config import load_config
from bot.feeds.chainlink import ChainlinkFeed

# Configure logging to see the outputs clearly when running the test
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def prevent_windows_sleep():
    if os.name == 'nt':
        try:
            # ES_CONTINUOUS = 0x80000000 | ES_SYSTEM_REQUIRED = 0x00000001
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
            logger.info("Prevented Windows from auto-sleeping.")
        except Exception as e:
            logger.warning(f"Failed to prevent Windows sleep: {e}")

def test_chainlink_feed_live():
    """
    Real test that connects to Chainlink using config,
    polls for prices, and logs price updates for a short duration.
    """
    asyncio.run(_test_chainlink_feed_live(continuous=False))

async def _test_chainlink_feed_live(continuous: bool = False):
    prevent_windows_sleep()
    
    # 1. Load config (validate=False avoids needing full .env API keys just to test feeds)
    config = load_config(validate=False)    

    # 2. Callback for each price update
    count = 0
    def on_update(source: str, price: float):
        nonlocal count
        count = (count + 1) % 300
        if count == 1:
            logger.info(f"Received update from {source}: ${price:.2f}")

    # 3. Initialize feed
    feed = ChainlinkFeed(
        feed_id=config.feeds.chainlink_feed_id,
        poll_seconds=config.feeds.chainlink_poll_seconds,
        on_update=on_update
    )

    # 4. Start the feed in a background task
    task = asyncio.create_task(feed.connect())
    
    # 5. Let it run
    if continuous:
        logger.info("Listening for Chainlink price updates continuously. Press Ctrl+C to stop...")
        try:
            while True:
                await asyncio.sleep(60 * 60 * 24)
        except asyncio.CancelledError:
            pass
    else:
        # Note: DrissionPage can take ~10-15 seconds to bypass Cloudflare initially.
        # We wait 30 seconds for the automated test to ensure we get data.
        logger.info("Listening for Chainlink price updates for 5 minutes...")
        await asyncio.sleep(60*5)
    
    # 6. Stop the feed and wait for the task to exit
    logger.info("Stopping feed...")
    feed.stop()
    await task    

if __name__ == "__main__":
    try:
        asyncio.run(_test_chainlink_feed_live(continuous=True))
    except KeyboardInterrupt:
        logger.info("Stopped by user.")

# $env:PYTHONPATH="."; uv run pytest tests/test_chainlink.py -s -v --log-cli-level=INFO

# $env:PYTHONPATH=".";  uv run python tests/test_chainlink.py
