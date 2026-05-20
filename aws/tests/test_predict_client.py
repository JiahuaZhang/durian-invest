import asyncio
import json
import logging
import os
from decimal import Decimal

import httpx

from bot.config import load_config
from bot.predict.client import PredictClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
FORCE_SMART_ORDER_MAINNET_ENV = "PREDICT_SMART_ORDER_MAINNET"


def _pretty_json(data):
    return json.dumps(data, indent=2, sort_keys=True, default=str)


def _decimal_or_none(value) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _select_expensive_outcome(market: dict) -> tuple[dict, Decimal | None]:
    outcomes = market.get("outcomes") or []
    if not outcomes:
        raise ValueError("Market has no outcomes")

    selected: dict = {}
    selected_quote: Decimal | None = None
    for outcome in outcomes:
        best_ask = outcome.get("bestAsk")
        quote = _decimal_or_none(best_ask.get("price")) if best_ask else None
        if quote is not None and (selected_quote is None or quote > selected_quote):
            selected = outcome
            selected_quote = quote

    return selected, selected_quote


def _extract_order_id(response: dict | None) -> str | None:
    if not response:
        return None
    data = response.get("data") if isinstance(response.get("data"), dict) else response
    order_id = data.get("orderId")
    return str(order_id) if order_id else None


def test_predict_market():
    asyncio.run(_test_predict_market())


async def _test_predict_market():
    config = load_config(validate=False)
    client = PredictClient(config)

    slug = PredictClient.get_category_slug("btc", 5)
    logger.info("categorySlug: %s", slug)

    market = await client.get_current_5m_crypto_market("btc")
    logger.info("market payload:\n%s", json.dumps(market, indent=2, default=str))

    start_price = await PredictClient.get_start_price("btc")
    logger.info("start price: %s", start_price)

    # Test auth; the client logs and returns None if no private key is configured.
    logger.info("Testing get_jwt...")
    jwt = await client.get_jwt()
    logger.info("JWT: %s", jwt + "..." if jwt else "None")


def test_smart_minimum_order_size():
    assert PredictClient.minimum_order_size(Decimal("0.1")) == Decimal("9")
    assert PredictClient.minimum_order_size(Decimal("0.01")) == Decimal("90")


def test_predict_smart_minimum_order():
    asyncio.run(_test_predict_smart_minimum_order())


async def _test_predict_smart_minimum_order():
    config = load_config(validate=False)
    if os.getenv(FORCE_SMART_ORDER_MAINNET_ENV) == "1":
        config.predict.is_test = False

    client = PredictClient(config)
    price = Decimal("0.01")
    size = PredictClient.minimum_order_size(price)
    network = "testnet" if config.predict.is_test else "mainnet"
    logger.info("Testing smart_minimum_order on %s: price=%s calculated_size=%s", network, price, size)

    market = await client.get_current_5m_crypto_market("btc")
    logger.info("market payload:\n%s", _pretty_json(market))

    outcome, quote = _select_expensive_outcome(market)
    outcome_name = outcome.get("name", "Up")
    logger.info("selected expensive outcome=%s quote=%s payload:\n%s", outcome_name, quote, _pretty_json(outcome))
    if quote is not None and quote <= price:
        logger.warning(
            "Selected outcome quote %s is at or below bid price %s; skipping create to avoid execution.",
            quote,
            price,
        )
        return

    try:
        create_response = await client.smart_minimum_order(
            market=market,
            outcome_name=outcome_name,
            side="BUY",
            price=price,
            is_post_only=True,
            return_full_response=True,
        )
    except httpx.HTTPStatusError as e:
        logger.error(
            "smart_minimum_order create failed: status=%s response:\n%s",
            e.response.status_code,
            e.response.text,
        )
        return

    logger.info("smart_minimum_order create response:\n%s", _pretty_json(create_response))

    order_id = _extract_order_id(create_response)
    if not order_id:
        logger.warning("Create order response had no order id, skipping cancel.")
        return

    cancel_response = await client.cancel_orders([order_id])
    logger.info("cancel order response:\n%s", _pretty_json(cancel_response))

# $env:PYTHONPATH="."; uv run pytest tests/test_predict_client.py -s -v --log-cli-level=INFO
