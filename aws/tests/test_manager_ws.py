import asyncio
import logging

from bot.config import load_config
from bot.strategy.manager import FeedManager

# Configure logging to see the outputs clearly when running the test
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("test_manager_ws")

def test_manager_ws_live():
    """
    Sync wrapper to run the async test using asyncio.run().
    """
    asyncio.run(_test_manager_ws_live())

async def _test_manager_ws_live():
    """
    Test logic that runs FeedManager indefinitely and stops after 2 resolved markets.
    """
    logger.info("Loading config...")
    cfg = load_config(validate=False)
    
    logger.info("Initializing FeedManager...")
    manager = FeedManager(cfg)
    
    logger.info("Starting FeedManager run task...")
    # manager.run() now blocks indefinitely, so we run it in a task
    run_task = asyncio.create_task(manager.run())
    
    # Give it a few seconds to initialize and activate the first window
    await asyncio.sleep(5)
    
    if not manager.states:
        logger.warning("No state was created. Market might not exist or activation failed.")
        manager.stop()
        run_task.cancel()
        return

    logger.info("Waiting 15 seconds before starting the observation loop...")
    await asyncio.sleep(15)
    
    resolved_count = 0
    seen_assets = set(manager.states.keys())
    resolved_assets = set()

    logger.info("Starting orderbook render and resolution monitoring loop...")
    try:
        while resolved_count < 2:
            current_assets = set(manager.states.keys())
            
            # Track new assets
            for aid in current_assets:
                if aid not in seen_assets:
                    logger.info(f"New asset discovered: {aid}")
                    seen_assets.add(aid)
            
            # Detect resolved assets (seen but now gone)
            for aid in list(seen_assets):
                if aid not in current_assets and aid not in resolved_assets:
                    resolved_assets.add(aid)
                    resolved_count += 1
                    logger.info(f"Market resolved detected! Total resolved: {resolved_count}/2")
            
            if resolved_count >= 2:
                break
                
            # Render orderbook for all active states
            for asset_id, state in manager.states.items():
                logger.info(f"--- Rendering Orderbook for {asset_id} ---")
                state.render()

            await asyncio.sleep(60)
            
    finally:
        logger.info("Stopping manager and cancelling run task...")
        manager.stop()
        run_task.cancel()
        try:
            await run_task
        except asyncio.CancelledError:
            pass

    logger.info(f"Test finished successfully. Observed {resolved_count} resolved markets.")

if __name__ == "__main__":
    test_manager_ws_live()

# $env:PYTHONPATH="."; uv run pytest tests/test_manager_ws.py -s -v --log-cli-level=INFO