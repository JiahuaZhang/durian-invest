from __future__ import annotations

from bot.config import BotConfig
from bot.markets import Market
from bot.runner import UpDownBot


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


class FakeBookFeed:
    def get_book(self, token_id):
        if token_id == "up-token":
            return {
                "bids": [{"price": "0.47", "size": "100"}],
                "asks": [{"price": "0.48", "size": "10"}],
            }
        return {
            "bids": [{"price": "0.51", "size": "10"}],
            "asks": [{"price": "0.52", "size": "10"}],
        }


def test_runner_combines_divergence_and_imbalance(monkeypatch):
    bot = UpDownBot(BotConfig(dry_run=True))
    bot.binance.price = 100_100
    bot.coinbase.price = 100_100
    bot.chainlink.price = 100_000
    bot.binance.last_update = 1e12
    bot.coinbase.last_update = 1e12
    bot.chainlink.last_update = 1e12
    monkeypatch.setattr("bot.runner.fetch_orderbook", lambda *args, **kwargs: None)

    signal = bot._check_signals(market(), FakeBookFeed())

    assert signal is not None
    assert signal.side == "up"
    assert signal.entry_price == 0.48
