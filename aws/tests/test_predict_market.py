import asyncio
import json
import logging

from bot.config import load_config
from bot.predict.market import PredictMarketClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def test_predict_market():
    asyncio.run(_test_predict_market())


async def _test_predict_market():
    config = load_config(validate=False)
    client = PredictMarketClient(config.predict)

    slug = PredictMarketClient.get_category_slug("btc", 5)
    logger.info("categorySlug: %s", slug)

    market = await client.get_current_5m_crypto_market("btc")
    logger.info("market payload:\n%s", json.dumps(market, indent=2, default=str))

    start_price = await PredictMarketClient.get_start_price("btc")
    logger.info("start price: %s", start_price)

# $env:PYTHONPATH="."; uv run pytest tests/test_predict_market.py -s -v --log-cli-level=INFO
