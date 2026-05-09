from __future__ import annotations

import pytest

from bot.config import BotConfig, ConfigError


def test_bot_config_defaults_are_dry_run_and_no_live():
    cfg = BotConfig()

    assert cfg.dry_run is True
    assert cfg.live_trading is False
    assert cfg.crypto == "btc"
    assert cfg.use_proxy is False
    assert cfg.order_size == 5.0


def test_proxy_auto_uses_local_port_probe(monkeypatch):
    monkeypatch.setattr("bot.config._tcp_open", lambda host, port: True)

    cfg = BotConfig(proxy_enabled="auto")

    assert cfg.use_proxy is True
    assert cfg.proxies["https"] == "socks5h://127.0.0.1:9090"


def test_proxy_auto_is_disabled_on_aws(monkeypatch):
    monkeypatch.setenv("DEPLOY_ENV", "aws")
    monkeypatch.setattr("bot.config._tcp_open", lambda host, port: True)

    assert BotConfig(proxy_enabled="auto").use_proxy is False


def test_invalid_signature_type_raises():
    with pytest.raises(ConfigError, match="signature-type"):
        BotConfig(signature_type=9).validate()


def test_live_trading_with_proxy_is_rejected(monkeypatch):
    monkeypatch.setattr("bot.config._tcp_open", lambda host, port: True)
    cfg = BotConfig(
        private_key="0x" + "1" * 64,
        funder_address="0xabc",
        clob_api_key="key",
        clob_secret="secret",
        clob_pass_phrase="pass",
        dry_run=False,
        live_trading=True,
        proxy_enabled="auto",
    )

    with pytest.raises(ConfigError, match="proxy"):
        cfg.validate()


def test_live_trading_requires_credentials():
    with pytest.raises(ConfigError, match="Missing live-trading"):
        BotConfig(dry_run=False, live_trading=True).validate()
