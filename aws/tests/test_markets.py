from __future__ import annotations

from bot.markets import parse_market


def sample_market(**overrides):
    market = {
        "conditionId": "0xcondition",
        "questionID": "0xquestion",
        "question": "Bitcoin Up or Down - May 5, 9:05AM-9:10AM ET",
        "slug": "btc-updown-5m-1777986300",
        "clobTokenIds": '["up-token", "down-token"]',
        "outcomes": '["Up", "Down"]',
        "outcomePrices": '["0.485", "0.515"]',
        "orderPriceMinTickSize": 0.01,
        "negRisk": False,
        "active": True,
        "endDate": "2026-05-05T13:10:00Z",
        "description": "test",
    }
    market.update(overrides)
    return market


def test_parse_market_handles_gamma_string_fields():
    market = parse_market(sample_market())

    assert market is not None
    assert market.condition_id == "0xcondition"
    assert market.up_token_id == "up-token"
    assert market.down_token_id == "down-token"
    assert market.yes_token_id == "up-token"
    assert market.no_token_id == "down-token"
    assert market.outcomes == ["Up", "Down"]
    assert market.outcome_prices == ["0.485", "0.515"]
    assert market.tick_size == "0.01"


def test_parse_market_skips_missing_token_ids():
    assert parse_market(sample_market(clobTokenIds='["only-one"]')) is None


def test_parse_market_skips_missing_condition_id():
    assert parse_market(sample_market(conditionId="")) is None
