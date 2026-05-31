import logging
from bot.config import BotConfig
from bot.strategy.predict_manager import PredictManager

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def main():
    """
    Runs the PredictManager continuously in watching mode.
    This script is intended to be run manually to observe the bot's behavior over time.
    """
    cfg = BotConfig()
    
    # Enable watching mode to prevent placing real orders during the test
    manager = PredictManager(cfg=cfg, watching=True)
    
    logger.info("Starting PredictManager continuously. Press Ctrl+C to stop.")
    
    try:
        # This will run indefinitely until the stop_event is set or it is interrupted.
        await manager.run()
    except KeyboardInterrupt:
        logger.info("Interrupted by user. Stopping manager...")
        manager.stop_event.set()

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())

# $env:PYTHONPATH="."; uv run python tests/test_predict_manager.py
