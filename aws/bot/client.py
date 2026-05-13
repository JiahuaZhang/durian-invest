"""
Polymarket CLOB V2 client factory.

py_clob_client_v2 issues every REST call through a module-level
``httpx.Client`` (``py_clob_client_v2.http_helpers.helpers._http_client``).
To route those calls through a SOCKS5 proxy — e.g. to bypass the
``Trading restricted in your region`` 403 — we replace that singleton with
an ``httpx.Client`` configured with ``proxy=``. SOCKS5 support comes from
``httpx[socks]``, which is already in pyproject.
"""

import logging

import httpx
from py_clob_client_v2 import ApiCreds, ClobClient, OrderArgs, PartialCreateOrderOptions, OrderArgsV2, OrderType
from py_clob_client_v2.http_helpers import helpers as clob_http_helpers
from py_clob_client_v2.order_builder.constants import BUY

from bot.config import load_config

logger = logging.getLogger(__name__)

client: ClobClient | None = None


def get_client() -> ClobClient:
    global client
    if client:
        return client

    config = load_config()
    proxy = config.httpx_proxy

    clob_http_helpers._http_client = httpx.Client(
        http2=True,
        proxy=proxy,
        timeout=15.0,
    )
    logger.info("CLOB client proxy=%s", proxy or "direct")

    client = ClobClient(
        host="https://clob.polymarket.com",
        chain_id=137,
        key=config.private_key,
        creds=ApiCreds(
            api_key=config.clob_api_key,
            api_secret=config.clob_secret,
            api_passphrase=config.clob_pass_phrase,
        ),
        signature_type=config.signature_type,
        funder=config.address,
    )
    return client

def limit_order(order_args: OrderArgsV2,
        options: PartialCreateOrderOptions = None,
        order_type: OrderType = OrderType.GTC,
        post_only: bool = False,
        defer_exec: bool = False,):
    client = get_client()
    return client.create_and_post_order(order_args=order_args, options=options, order_type=order_type, post_only=post_only, defer_exec=defer_exec)