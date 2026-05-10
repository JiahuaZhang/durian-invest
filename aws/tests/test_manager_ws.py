import asyncio
import logging

from bot.config import load_config
from bot.strategy.manager import FeedManager

# Configure logging to see the outputs clearly when running the test
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("test_manager_ws")

def test_manager_ws_live():
    """
    Sync wrapper to run the async test using asyncio.run(),
    avoiding the need for pytest-asyncio plugin.
    """
    asyncio.run(_test_manager_ws_live())

async def _test_manager_ws_live():
    """
    Actual test logic that connects to Polymarket WS via FeedManager,
    renders the orderbook every 5s after 15s delay,
    and shuts down once the market is resolved.
    """
    logger.info("Loading config...")
    cfg = load_config(validate=False)
    
    logger.info("Initializing FeedManager...")
    manager = FeedManager(cfg)
    
    logger.info("Starting FeedManager...")
    await manager.start()
    
    if not manager.states:
        logger.warning("No state was created during start. Market might not exist.")
        manager.stop()
        return

    logger.info("Waiting 15 seconds before checking orderbook...")
    await asyncio.sleep(15)
    
    logger.info("Starting orderbook render loop...")
    while True:
        if not manager.states:
            logger.info("No active states found. Assuming market is resolved. Shutting down test.")
            break
            
        logger.info("Rendering orderbook for active states...")
        for asset_id, state in manager.states.items():
            logger.info(f"--- State for asset: {asset_id} ---")
            state.render()
            
        await asyncio.sleep(5)
        
    logger.info("Stopping manager...")
    manager.stop()
    logger.info("Test finished successfully.")

if __name__ == "__main__":
    test_manager_ws_live()

# $env:PYTHONPATH="."; uv run pytest tests/test_manager_ws.py -s -v --log-cli-level=INFO