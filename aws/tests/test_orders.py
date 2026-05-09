from __future__ import annotations

import pytest

from bot.config import BotConfig, ConfigError
from bot.markets import Market
from bot.orders import Side, cancel_order, place_order


def market() -> Market:
    return Market(
        condition_id="0xcondition",
        question_id="0xquestion",
        question="Bitcoin Up or Down",
        slug="btc-updown-5m-1",
        up_token_id="up-token",
        down_token_id="down-token",
        outcomes=["Up", "Down"],
        outcome_prices=["0.48", "0.52"],
        tick_size="0.01",
        neg_risk=False,
        active=True,
        end_date="2026-05-05T13:10:00Z",
    )


class FakeClient:
    def __init__(self):
        self.posted = []
        self.cancelled = []

    def create_and_post_order(self, **kwargs):
        self.posted.append(kwargs)
        return {"orderID": "order-123", "status": "LIVE"}

    def cancel_order(self, payload):
        self.cancelled.append(payload)
        return {"cancelled": True}


def test_dry_run_does_not_call_client():
    client = FakeClient()
    result = place_order(
        client,
        BotConfig(dry_run=True),
        market(),
        side=Side.BUY,
        price=0.48,
        size=5,
        token_index=0,
    )

    assert result.status == "DRY_RUN"
    assert result.token_id == "up-token"
    assert client.posted == []


def test_dry_run_down_side_uses_down_token():
    result = place_order(
        None,
        BotConfig(dry_run=True),
        market(),
        side=Side.BUY,
        price=0.52,
        size=5,
        token_index=1,
    )

    assert result.token_id == "down-token"


def test_non_dry_run_requires_live_trading_flag():
    with pytest.raises(ConfigError, match="LIVE_TRADING"):
        place_order(
            FakeClient(),
            BotConfig(dry_run=False, live_trading=False),
            market(),
            side=Side.BUY,
            price=0.48,
            size=5,
        )


def test_live_place_order_calls_sdk_method():
    client = FakeClient()
    result = place_order(
        client,
        BotConfig(dry_run=False, live_trading=True),
        market(),
        side=Side.BUY,
        price=0.48,
        size=5,
    )

    assert result.order_id == "order-123"
    assert len(client.posted) == 1


def test_cancel_order_wraps_order_payload():
    client = FakeClient()

    assert cancel_order(client, BotConfig(dry_run=False, live_trading=True), "order-123") is True
    assert client.cancelled[0].orderID == "order-123"
