"""
Derive Polymarket CLOB L2 API credentials from PRIVATE_KEY.

This script prints .env-compatible lines for local use. It refuses proxy mode
because credential derivation is authenticated, not public read-only traffic.
"""

from __future__ import annotations

import sys
from pathlib import Path
from py_clob_client_v2 import ClobClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bot.config import ConfigError, load_config


def main() -> int:
    try:
        config = load_config(validate=False)
        client = ClobClient(
            host="https://clob.polymarket.com",
            chain_id=137,  # Polygon mainnet
            key=config.private_key
        )
        creds = client.create_or_derive_api_key()

        print("CLOB_API_KEY=" + creds.api_key)
        print("CLOB_SECRET=" + creds.api_secret)
        print("CLOB_PASS_PHRASE=" + creds.api_passphrase)
        return 0

    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    


if __name__ == "__main__":
    raise SystemExit(main())


# $env:PYTHONPATH="."; uv run .\script\derive_keys.py