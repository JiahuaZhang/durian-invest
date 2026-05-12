"""
Polymarket CLOB V2 client factories.

py-clob-client-v2 uses a module-level httpx.Client internally. Configure that
client directly when a public/read-only dry-run request should use SOCKS5.
Authenticated clients intentionally refuse proxy mode.
"""

from __future__ import annotations

import httpx
import structlog
from py_clob_client_v2 import ApiCreds, ClobClient
from py_clob_client_v2.http_helpers import helpers as clob_http_helpers

from bot.config import ConfigError, load_config
from .config import BotConfig, ConfigError

log = structlog.get_logger()

client: ClobClient | None = None

def get_client():
    if client:
        return client
    
    config = load_config()
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
        funder=config.address
    )
    return client