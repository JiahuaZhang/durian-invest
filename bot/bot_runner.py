import sys
import asyncio
import logging
import datetime
import zoneinfo
from typing import List
from dotenv import load_dotenv

from strategies.base_strategy import TradingStrategy
from strategies.kalshi_crypto.strategy import KalshiCryptoStrategy

load_dotenv()

_EASTERN = zoneinfo.ZoneInfo('America/New_York')

class _EasternFormatter(logging.Formatter):
    def formatTime(self, record, datefmt=None):
        dt = datetime.datetime.fromtimestamp(record.created, tz=_EASTERN)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.strftime('%Y-%m-%d %H:%M:%S') + f',{int(record.msecs):03d} ET'

_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(_EasternFormatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
logging.basicConfig(level=logging.INFO, handlers=[_handler])
logger = logging.getLogger(__name__)


class BotRunner:
    def __init__(self, strategies: List[TradingStrategy]):
        self.strategies = strategies
        self.shutdown_event = asyncio.Event()

        logger.info("=" * 70)
        logger.info("DURIAN INVEST - MULTI-STRATEGY BOT")
        logger.info("=" * 70)
        for s in strategies:
            logger.info(f"  - {s.get_name()} ({s.get_type()})")

    async def run(self):
        tasks = [s.start() for s in self.strategies]
        tasks.append(self._wait_for_shutdown())
        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            pass

    async def _wait_for_shutdown(self):
        await self.shutdown_event.wait()
        await self._shutdown()

    async def _shutdown(self):
        logger.info("Shutting down...")
        self.shutdown_event.set()
        for s in self.strategies:
            try:
                await s.stop()
            except Exception as e:
                logger.error(f"Error stopping {s.get_name()}: {e}")
        logger.info("All strategies stopped")


async def main():
    all_classes = [KalshiCryptoStrategy]

    enabled = []
    for cls in all_classes:
        try:
            s = cls()
        except Exception as e:
            logger.error(f"Failed to initialize {cls.__name__}: {e}")
            sys.exit(1)
        if not s.is_enabled():
            logger.info(f"Skipping disabled strategy: {s.get_name()}")
            continue
        enabled.append(s)

    if not enabled:
        logger.info("No strategies enabled. Set 'enabled: true' in strategy config.")
        return

    bot = BotRunner(enabled)

    try:
        await bot.run()
    except KeyboardInterrupt:
        await bot._shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot stopped")
