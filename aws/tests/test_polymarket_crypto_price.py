import asyncio
import logging

from bot.config import load_config
from bot.market_state import get_market_slug
from bot.feeds.polymarket_crypto_price import PolymarketCryptoPrice

# Configure logging to see the outputs clearly when running the test
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_polymarket_crypto_price():
    """
    Real test that fetches the open price for the current Polymarket 5-minute slug.
    """
    asyncio.run(_test_polymarket_crypto_price())

async def _test_polymarket_crypto_price():
    # 1. Load config (validate=False avoids needing full .env API keys)
    config = load_config(validate=False)
    
    # 2. Get the current market slug
    # This automatically computes the 5-minute bucket for the current UTC time
    slug = get_market_slug(crypto="btc", interval_minutes=5, offset=0)
    logger.info(f"Generated market slug: {slug}")
    
    # 3. Fetch the open price
    logger.info("Fetching open price from Polymarket...")
    price = await PolymarketCryptoPrice.get_open_price(slug)
    
    # 4. Log the resulting price
    logger.info(f"Result for '{slug}': Bitcoin Open Price = {price}")
    
    # 5. Simple assertions
    assert price is not None, f"Failed to retrieve the open price for {slug}. (Check API format or proxy settings)"
    assert isinstance(price, float), "Open price should be returned as a float."
    
    logger.info("Test complete. Successfully fetched open price.")

# $env:PYTHONPATH="."; uv run pytest tests/test_polymarket_crypto_price.py -s -v --log-cli-level=INFO
