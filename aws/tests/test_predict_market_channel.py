from apscheduler.schedulers import asyncio
import asyncio
import json
import logging

from bot.config import load_config
from bot.predict.market import PredictMarketClient
from bot.predict.market_channel import PredictMarketChannel

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def test_predict_market_channel():
    asyncio.run(_test_predict_market_channel())


async def _test_predict_market_channel():
    config = load_config(validate=False)
    client = PredictMarketClient(config.predict)

    market = await client.get_current_5m_crypto_market("btc")
    if market is None:
        logger.warning("No BTC 5m market available — skipping channel test")
        return

    market_id = market["id"]

    def on_message(msg: dict) -> None:
        logger.info("WS message:\n%s", json.dumps(msg))
        # logger.info("WS message:\n%s", json.dumps(msg, indent=2, default=str))

    channel = PredictMarketChannel(config.predict, on_message)
    # subscribe to both orderbook and price feed (using market_id as number)

    task = asyncio.create_task(channel.connect())

    await asyncio.sleep(1)

    channel.subscribe([
        f"predictOrderbook/{market_id}",
    ])

    logger.info("Listening for 30 seconds...")
    await asyncio.sleep(300)

    channel.stop()
    await task

# $env:PYTHONPATH="."; uv run pytest tests/test_predict_market_channel.py -s -v --log-cli-level=INFO
