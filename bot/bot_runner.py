import os
import sys
import signal
import asyncio
import logging
from typing import List
from dotenv import load_dotenv

from strategies import StrategyRegistry, TradingStrategy, load_strategy_module

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


class BotRunner:
    def __init__(self, strategy_names: List[str]):
        self.strategy_names = strategy_names
        self.strategies: List[TradingStrategy] = []
        self.shutdown_event = asyncio.Event()
        
        logger.info("=" * 70)
        logger.info("🚀 DURIAN INVEST - MULTI-STRATEGY BOT")
        logger.info("=" * 70)
        logger.info(f"Strategies to load: {', '.join(strategy_names)}")
    
    async def load_strategies(self):
        for name in self.strategy_names:
            try:
                strategy = StrategyRegistry.create(name)
                await strategy.initialize()
                self.strategies.append(strategy)
                logger.info(f"✅ Loaded strategy: {name} ({strategy.get_type()})")
            except Exception as e:
                logger.error(f"❌ Failed to load strategy '{name}': {e}")
                sys.exit(1)
        logger.info(f"\n✅ All {len(self.strategies)} strategies loaded successfully")
    
    async def run(self):
        if not self.strategies:
            logger.error("No strategies loaded!")
            return
        
        logger.info("\n" + "=" * 70)
        logger.info("▶️  STARTING ALL STRATEGIES")
        logger.info("=" * 70)
        
        tasks = [strategy.start() for strategy in self.strategies]
        tasks.append(self._wait_for_shutdown())
        
        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            logger.info("\n🛑 Shutdown initiated...")
    
    async def _wait_for_shutdown(self):
        await self.shutdown_event.wait()
        await self.shutdown()
    
    async def shutdown(self):
        logger.info("\n" + "=" * 70)
        logger.info("🛑 SHUTTING DOWN")
        logger.info("=" * 70)
        
        self.shutdown_event.set()
        
        for strategy in self.strategies:
            try:
                logger.info(f"Stopping {strategy.get_name()}...")
                await strategy.stop()
            except Exception as e:
                logger.error(f"Error stopping {strategy.get_name()}: {e}")
        
        logger.info("✅ All strategies stopped")
        logger.info("=" * 70)


async def main():
    # gemini-portfolio,sma
    strategies_env = os.getenv('STRATEGIES', 'kalshi-crypto')
    strategy_names = [s.strip() for s in strategies_env.split(',')]
    logger.info(f"Strategies to load: {strategy_names}")

    for name in strategy_names:
        load_strategy_module(name)

    for name in strategy_names:
        if not StrategyRegistry.is_registered(name):
            available = ', '.join(StrategyRegistry.list_strategies())
            logger.error(f"❌ Unknown strategy: '{name}'")
            logger.error(f"Available strategies: {available}")
            sys.exit(1)
    
    bot = BotRunner(strategy_names)
    
    if sys.platform != 'win32':
        loop = asyncio.get_event_loop()
        
        def signal_handler():
            logger.info("\n🛑 Received shutdown signal (Ctrl+C)")
            asyncio.create_task(bot.shutdown())
        
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, signal_handler)
    
    await bot.load_strategies()
    
    try:
        await bot.run()
    except KeyboardInterrupt:
        logger.info("\n🛑 Received keyboard interrupt")
        await bot.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n✅ Bot stopped")
