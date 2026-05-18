"""
Typed configuration for the Polymarket BTC 5-min bot.

Loads config.yml for strategy params and merges .env for mode flags +
CLOB API credentials. Values inside config.yml may reference environment
variables using ``${VAR}`` (required) or ``${VAR:-default}`` (optional).
"""

from __future__ import annotations

import os
import re
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

TRUE_VALUES = {"1", "true", "yes", "y", "on"}
FALSE_VALUES = {"0", "false", "no", "n", "off"}
VALID_PROXY_MODES = {"auto", "true", "false"}
VALID_CRYPTOS = {"btc", "eth", "sol", "xrp", "doge", "hype", "bnb"}

# ${VAR} or ${VAR:-default}
_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


class ConfigError(ValueError):
    """Raised when configuration is invalid or unsafe."""


@dataclass
class SignalConfig:
    divergence_threshold: float = 50.0
    imbalance_bullish: float = 1.8
    imbalance_bearish: float = 0.55
    imbalance_levels: int = 10


@dataclass
class ExitConfig:
    take_profit: float = 0.75
    stop_loss: float = 0.35


@dataclass
class FeedConfig:
    binance_symbol: str = "btcusdt"
    coinbase_product: str = "BTC-USD"
    chainlink_feed_id: str = "0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8"
    chainlink_poll_seconds: int = 1


PREDICT_API_HOST_MAINNET = "https://api.predict.fun"
PREDICT_API_HOST_TESTNET = "https://api-testnet.predict.fun"


@dataclass
class PredictConfig:
    """Predict.fun REST + WebSocket endpoints.

    Testnet (default): no API key required, no real cash at risk.
    Mainnet: set ``is-test: False`` and supply ``PREDICT_API_KEY``.
    """
    is_test: bool = True
    api_key: str = ""
    private_key: str = field(default="", repr=False)

    @property
    def api_host(self) -> str:
        return PREDICT_API_HOST_TESTNET if self.is_test else PREDICT_API_HOST_MAINNET

    @property
    def credentials(self) -> str:
        return "" if self.is_test else self.api_key


@dataclass
class BotConfig:
    name: str = "polymarket-btc-5m"
    enabled: bool = True

    # Wallet — populated from config.yml's polymarket.{private-key, address}
    # which typically reference ${POLYMARKET_PRIVATE_KEY} / ${POLYMARKET_ADDRESS}.
    private_key: str = field(default="", repr=False)
    address: str = ""
    # 0=EOA, 1=POLY_PROXY (older email-signup), 2=POLY_GNOSIS_SAFE (newer),
    # 3=POLY_1271 (arbitrary smart-contract wallet).
    signature_type: int = 0

    # Polymarket L2 API credentials (from .env, only required for live trading)
    clob_api_key: str = field(default="", repr=False)
    clob_secret: str = field(default="", repr=False)
    clob_pass_phrase: str = field(default="", repr=False)

    proxy_enabled: bool | str = False
    proxy_host: str = "127.0.0.1"
    proxy_port: int = 9090

    crypto: str = "btc"
    interval_minutes: int = 5

    feeds: FeedConfig = field(default_factory=FeedConfig)
    predict: PredictConfig = field(default_factory=PredictConfig)
    signals: SignalConfig = field(default_factory=SignalConfig)
    exit: ExitConfig = field(default_factory=ExitConfig)

    order_size: float = 1.0

    @property
    def use_proxy(self) -> bool:
        if isinstance(self.proxy_enabled, bool):
            return self.proxy_enabled
        if self.proxy_enabled == "auto":
            return _tcp_open(self.proxy_host, self.proxy_port)
        return False

    @property
    def socks5_url(self) -> str:
        return f"socks5h://{self.proxy_host}:{self.proxy_port}"

    @property
    def proxies(self) -> dict[str, str]:
        if not self.use_proxy:
            return {}
        return {"http": self.socks5_url, "https": self.socks5_url}

    @property
    def httpx_proxy(self) -> str | None:
        return self.socks5_url if self.use_proxy else None

    @property
    def has_private_key(self) -> bool:
        return bool(self.private_key)

    @property
    def has_api_creds(self) -> bool:
        return bool(self.clob_api_key and self.clob_secret and self.clob_pass_phrase)

    def validate(
        self,
        *,
        require_private_key: bool = False,
        require_live_credentials: bool = False,
    ) -> None:
        if self.crypto not in VALID_CRYPTOS:
            raise ConfigError(f"contract.crypto must be one of {sorted(VALID_CRYPTOS)}, got {self.crypto!r}")
        if isinstance(self.proxy_enabled, str) and self.proxy_enabled not in VALID_PROXY_MODES:
            raise ConfigError(f"proxy.enabled must be true, false, or auto, got {self.proxy_enabled!r}")
        if not (1 <= self.proxy_port <= 65535):
            raise ConfigError(f"proxy port must be 1-65535, got {self.proxy_port}")
        if require_private_key and not self.has_private_key:
            raise ConfigError("private-key is required (set POLYMARKET_PRIVATE_KEY in .env)")
        if require_live_credentials:
            missing: list[str] = []
            if not self.has_private_key:
                missing.append("POLYMARKET_PRIVATE_KEY")
            if not self.has_api_creds:
                missing.extend(["CLOB_API_KEY", "CLOB_SECRET", "CLOB_PASS_PHRASE"])
            if missing:
                raise ConfigError(f"Missing live-trading credential(s): {', '.join(missing)}")


def _tcp_open(host: str, port: int, timeout: float = 0.25) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _parse_boolish(value, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    raw = str(value if value is not None else default).strip().lower()
    if raw in TRUE_VALUES:
        return True
    if raw in FALSE_VALUES:
        return False
    raise ConfigError(f"Expected boolean value, got {value!r}")


def _parse_proxy_enabled(value) -> bool | str:
    if isinstance(value, bool):
        return value
    raw = str(value if value is not None else "false").strip().lower()
    if raw == "auto":
        return "auto"
    if raw in TRUE_VALUES:
        return True
    if raw in FALSE_VALUES:
        return False
    raise ConfigError(f"proxy.enabled must be true, false, or auto, got {value!r}")


def _substitute_env_vars(text: str) -> str:
    """Replace ``${VAR}`` / ``${VAR:-default}`` segments in a string.

    Missing required vars (no ``:-default``) raise ``ConfigError`` so
    config bugs surface at startup instead of as confusing empty strings.
    """
    def repl(match: re.Match) -> str:
        var_name = match.group(1)
        default = match.group(2)
        env_value = os.environ.get(var_name)
        if env_value is not None:
            return env_value
        if default is not None:
            return default
        raise ConfigError(
            f"Environment variable {var_name!r} is not set "
            f"(referenced in config.yml as ${{{var_name}}})"
        )
    return _ENV_PATTERN.sub(repl, text)


def _resolve_env(value: Any) -> Any:
    """Recursively resolve ``${VAR}`` references inside a parsed-YAML tree."""
    if isinstance(value, dict):
        return {k: _resolve_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_env(v) for v in value]
    if isinstance(value, str):
        return _substitute_env_vars(value)
    return value


def load_config(*, validate: bool = True) -> BotConfig:
    """Load config.yml (with ``${VAR}`` env substitution) + .env mode flags."""
    yml_path = Path(__file__).resolve().parent / "config.yml"
    c: dict = {}
    if yml_path.exists():
        with open(yml_path) as f:
            c = yaml.safe_load(f) or {}
    c = _resolve_env(c)

    poly = c.get("polymarket", {})
    proxy = c.get("proxy", {})
    contract = c.get("contract", {})
    feeds_raw = c.get("feeds", {})
    predict_raw = c.get("predict", {})
    signals_raw = c.get("signals", {})
    exit_raw = c.get("exit", {})

    cfg = BotConfig(
        name=c.get("name", "polymarket-btc-5m"),
        enabled=_parse_boolish(c.get("enabled", True), default=True),
        # Wallet — values come from config.yml after ${...} substitution
        private_key=poly.get("private-key", ""),
        address=poly.get("address", ""),
        signature_type=int(poly.get("signature-type", BotConfig.signature_type)),
        # CLOB API creds — env-only (not in config.yml)
        clob_api_key=os.getenv("CLOB_API_KEY", ""),
        clob_secret=os.getenv("CLOB_SECRET", ""),
        clob_pass_phrase=os.getenv("CLOB_PASS_PHRASE", ""),
        proxy_enabled=_parse_proxy_enabled(proxy.get("enabled", False)),
        proxy_host=proxy.get("host", "127.0.0.1"),
        proxy_port=int(proxy.get("port", 9090)),
        crypto=str(contract.get("crypto", "btc")).lower(),
        interval_minutes=int(contract.get("interval-minutes", 5)),
        feeds=FeedConfig(
            binance_symbol=feeds_raw.get("binance-symbol", FeedConfig.binance_symbol),
            coinbase_product=feeds_raw.get("coinbase-product", FeedConfig.coinbase_product),
            chainlink_feed_id=feeds_raw.get("chainlink-feed-id", FeedConfig.chainlink_feed_id),
            chainlink_poll_seconds=int(feeds_raw.get("chainlink-poll-seconds", FeedConfig.chainlink_poll_seconds)),
        ),
        predict=PredictConfig(
            is_test=_parse_boolish(predict_raw.get("is-test", True), default=True),
            api_key=predict_raw.get("api-key", ""),
            private_key=predict_raw.get("private-key", ""),
        ),
        signals=SignalConfig(
            divergence_threshold=float(signals_raw.get("divergence-threshold", SignalConfig.divergence_threshold)),
            imbalance_bullish=float(signals_raw.get("imbalance-bullish", SignalConfig.imbalance_bullish)),
            imbalance_bearish=float(signals_raw.get("imbalance-bearish", SignalConfig.imbalance_bearish)),
            imbalance_levels=int(signals_raw.get("imbalance-levels", SignalConfig.imbalance_levels)),
        ),
        exit=ExitConfig(
            take_profit=float(exit_raw.get("take-profit", ExitConfig.take_profit)),
            stop_loss=float(exit_raw.get("stop-loss", ExitConfig.stop_loss)),
        ),
    )
    if validate:
        cfg.validate()
    return cfg
