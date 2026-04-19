import asyncio
import logging
from datetime import datetime, timezone

from strategies.telegram_notifier import TelegramNotifier
from strategies.kalshi_crypto.config import CryptoJobConfig
from strategies.kalshi_crypto.kalshi_crypto_client import KalshiCryptoClient
from strategies.kalshi_crypto.market_state import current_market_ticker
from strategies.kalshi_crypto.supabase_logger import SupabaseLogger
from strategies.util import convert_utc_to_ny

logger = logging.getLogger(__name__)

POLL_INTERVAL = 2  # seconds between order-book checks


class Crypto15mJob:
    """
    Encapsulates all trading logic for one crypto series over a 15-min window.

    run() is triggered at :00/:15/:30/:45 and polls the order book every 2s
    until the market closes. Can also be called directly in tests.
    """

    def __init__(
        self,
        cfg: CryptoJobConfig,
        client: KalshiCryptoClient,
        db: SupabaseLogger | None,
        telegram: TelegramNotifier,
        use_demo: bool = False,
    ):
        self.cfg = cfg
        self._client = client
        self._db = db
        self._telegram = telegram
        self._use_demo = use_demo
        self._active_trade: dict = {}

    async def run(self):
        """
        Poll the order book every 2s for the duration of one 15-min window.

        Loop exits when:
          - secs_left < POLL_INTERVAL (market about to close)
          - market fetch returns status=closed
        """
        now = datetime.now(timezone.utc)
        ticker, close_time = current_market_ticker(self.cfg.series, now)
        secs_left = (close_time - now).total_seconds()

        logger.info(f"[{ticker}] — polling every {POLL_INTERVAL}s for {secs_left:.0f}s")

        while True:
            now = datetime.now(timezone.utc)
            secs_left = (close_time - now).total_seconds()

            if secs_left < POLL_INTERVAL:
                logger.info(f"[{ticker}] window closing — exiting poll loop")
                break

            await self._tick(ticker, secs_left)

            await asyncio.sleep(POLL_INTERVAL)

    async def _tick(self, ticker: str, secs_left: float):
        """
        One poll cycle.
        Returns (entered, market_closed):
          entered       — True if we just placed a trade this tick
          market_closed — True if the loop should stop (market resolved/gone)
        """
        if self._active_trade:
            await self.handle_exist_trade(ticker)
            return
            # market = await self._client.get_market(ticker)
            # side = self._active_trade["side"]
            # current_bid = float(market.get(f"{side}_bid_dollars"))
            # if current_bid > 0 and current_bid <= self._active_trade["stop_loss_price"]:
            #     await self._stop_loss_exit(ticker, self._active_trade, current_bid)
            # return

        market = await self._client.get_market(ticker)

        yes_ask = float(market.get("yes_ask_dollars")) * 100
        yes_bid = float(market.get("yes_bid_dollars")) * 100
        no_ask  = float(market.get("no_ask_dollars")) * 100
        no_bid  = float(market.get("no_bid_dollars")) * 100

        yes_in_zone = yes_ask >= self.cfg.entry_cents and yes_ask <= self.cfg.target_cents
        no_in_zone  = no_ask  >= self.cfg.entry_cents and no_ask <= self.cfg.target_cents

        logger.info(f"[{ticker}] yes_bid={yes_bid}¢ yes_ask={yes_ask}¢ no_bid={no_bid}¢ no_ask={no_ask}¢ yes_in_zone={yes_in_zone} no_in_zone={no_in_zone}")

        if yes_in_zone or no_in_zone:
            side_label = f"YES={yes_ask}¢ IN ZONE" if yes_in_zone else f"NO={no_ask}¢ IN ZONE"
            logger.info(
                f"{ticker}  YES bid={yes_bid}¢ ask={yes_ask}¢  "
                f"NO bid={no_bid}¢ ask={no_ask}¢  "
                f"{secs_left:.0f}s left  ✓ {side_label}"
            )
            side = "yes" if yes_in_zone else "no"
            ask_price = yes_ask if yes_in_zone else no_ask
            await self._enter(ticker, side, ask_price, secs_left)
        else:
            logger.debug(
                f"{ticker}  YES ask={yes_ask}¢  NO ask={no_ask}¢  "
                f"{secs_left:.0f}s left  "
                f"(want {self.cfg.entry_cents}¢)"
            )

    async def _enter(self, ticker: str, side: str, ask_price: float, secs_left: float):
        logger.info(f"[{ticker}] {side.upper()} @ {ask_price}¢ {secs_left:.0f}s left — entering")

        buy = None
        if side == 'yes':
            buy =  await self._client.place_order(ticker, side, action="buy", count=self.cfg.count, yes_price=ask_price)
        else:
            buy = await self._client.place_order(ticker, side, action="buy", count=self.cfg.count, no_price=ask_price)
        if not buy:
            logger.error(f"Buy order failed for {ticker} {side}")
            return

        if buy.get("status") == "resting":
            logger.error(f"Buy order {buy.get('order_id')} is resting for {ticker} {side}")
            self._telegram.send(f"⏳Pending {ticker} {side} @ {ask_price}¢ [{buy.get('order_id')}] on {convert_utc_to_ny(buy.get('created_time'))}")
            self._active_trade = {
                "status": "buy_resting",
                "side": side,
                "entry_price": ask_price,
                "buy_order": buy
            }
            return

        self._active_trade = {
            "status": "buy_executed",
            "side": side,
            "entry_price": ask_price,
            "buy_order": buy
        }
        await self.take_profit_leave(ticker, side, ask_price)

    async def take_profit_leave(self, ticker: str, side: str, start_price: float):
        env_tag = "[DEMO]" if self._use_demo else "[LIVE]"
        take_profit_price = min(start_price + 0.05, 0.99)

        sell = None
        if side == 'yes':
            sell = await self._client.place_order(ticker, side, action="sell", count=self.cfg.count, yes_price=take_profit_price)
        else:
            sell = await self._client.place_order(ticker, side, action="sell", count=self.cfg.count, no_price=take_profit_price)

        if sell.get("status") == "executed":
            self._telegram.send(f"✅Take profit {ticker} {side} @ {take_profit_price}¢ [{sell.get('order_id')}] on {convert_utc_to_ny(sell.get('created_time'))}")
            self._active_trade = None
            return

        await self._telegram.send(
            f"<b>[{ticker}] Scalp Signal {env_tag}</b>\n"
            f"<b>{side.upper()}</b> <b>{start_price}¢</b> → <b>{take_profit_price}¢</b>\n"
            f"Contracts: {self.cfg.count} | cost ~${start_price * self.cfg.count / 100:.2f}\n"
            f"Buy order placed @ {convert_utc_to_ny(self._active_trade['buy_order'].get('created_time'))}\n"
            f"Take profit order placed @ {convert_utc_to_ny(sell.get('created_time'))}\n"
        )

        stop_loss_price = start_price - 0.05
        self._active_trade = {
            "side": side,
            "status": "sell_resting",
            "entry_price": start_price,
            "sell_order": sell,
            "stop_loss_price": stop_loss_price,
        }

        if self._db:
            from .models import CryptoBet
            bet = CryptoBet(
                asset_id=self.cfg.series.lower(),
                strategy="scalp",
                market_ticker=ticker,
                side=side,
                contracts=self.cfg.contracts,
                price_per_contract=start_price / 100.0,
                total_cost=round(start_price * self.cfg.contracts / 100.0, 2),
                kalshi_order_id=sell.get("order_id", "") if sell else "failed",
                status="open",
            )
            await self._db.log_bet(bet)

    async def _stop_loss_exit(self, ticker: str, current_bid: float):
        side = self._active_trade["side"]
        entry_price = self._active_trade.get("entry_price", 0)
        sell_order = self._active_trade.get("sell_order")
        sell_id = sell_order.get("order_id")

        logger.warning(
            f"[{self.cfg.series}] {ticker} STOP LOSS  {side.upper()} bid={current_bid}¢ "
            f"≤ stop={self._active_trade['stop_loss_price']}¢ — exiting"
        )

        if sell_id:
            cancelled = await self._client.cancel_order(sell_id)
            if not cancelled:
                logger.error(
                    f"Failed to cancel profit-sell {sell_id} for {ticker} "
                    f"— proceeding with stop sell anyway"
                )
            self._telegram.send(f"❌ Fail to cancel {ticker} {side} @ {entry_price}¢ [{sell_id}] on {convert_utc_to_ny(cancelled.get('created_time'))}")

        exit_price = self._active_trade.get("stop_loss_price")
        stop_sell = None
        if side == 'yes':
            stop_sell = await self._client.place_order(ticker, side, "sell", self.cfg.contracts, yes_price=exit_price)
        else:
            stop_sell = await self._client.place_order(ticker, side, "sell", self.cfg.contracts, no_price=exit_price)

        if stop_sell.get("status") == "executed":
            self._telegram.send(f"❌Take profit {ticker} {self._active_trade['side']} @ {self._active_trade['entry_price']}¢ [{sell_order.get('order_id')}] on {convert_utc_to_ny(sell_order.get('created_time'))}")
        else:
            self._telegram.send(f"❌Fail to cancel {ticker} {side} @ {entry_price}¢ [{sell_id}] on {convert_utc_to_ny(cancelled.get('created_time'))}")    
        stop_sell_id = stop_sell.get("order_id", "") if stop_sell else "failed"

        loss_cents = (entry_price - exit_price) * self.cfg.contracts
        logger.warning(
            f"[{self.cfg.series}] {ticker} stop-sell placed @ {exit_price}¢  id={stop_sell_id}  "
            f"loss ~${loss_cents / 100:.2f}"
        )

        env_tag = " [DEMO]" if self._use_demo else ""
        await self._telegram.send(
            f"<b>[{self.cfg.series}] Stop Loss Hit{env_tag}</b>\n"
            f"Market: {ticker}\n"
            f"Side: {side.upper()} | Entry: {entry_price}¢ → Stop: {exit_price}¢\n"
            f"Loss: ~${loss_cents / 100:.2f}  |  order={stop_sell_id}"
        )

        self._active_trade = None

    async def handle_exist_trade(self, ticker: str):
        if self._active_trade.get("status") == "buy_resting":
            buy_order = await self._client.get_order(self._active_trade["buy_order"]["order_id"])
            if buy_order["status"] == "resting":
                return
            else:
                logger.info(f"[{self.cfg.series}] {ticker} Buy order filled")
                self._active_trade["status"] = "buy_executed"
                await self.take_profit_leave(ticker, self._active_trade["side"], self._active_trade["entry_price"])
                return
        elif self._active_trade.get("status") == "sell_resting":
            sell_order = await self._client.get_order(self._active_trade["sell_order"]["order_id"])
            if sell_order["status"] == "executed":
                logger.info(f"[{self.cfg.series}] {ticker} Sell order filled")
                self._telegram.send(f"✅Take profit {ticker} {self._active_trade['side']} @ {self._active_trade['entry_price']}¢ [{sell_order.get('order_id')}] on {convert_utc_to_ny(sell_order.get('created_time'))}")
                self._active_trade = None
                return
            else:
                market = await self._client.get_market(ticker)
                yes_ask = market.get("yes_ask_dollars")
                yes_bid = market.get("yes_bid_dollars")
                no_ask  = market.get("no_ask_dollars")
                no_bid  = market.get("no_bid_dollars")

                if self._active_trade["side"] == "yes":
                    if yes_ask < self._active_trade["stop_loss_price"]:
                        await self._stop_loss_exit(ticker, yes_bid)
                else:
                    if no_ask < self._active_trade["stop_loss_price"]:
                        await self._stop_loss_exit(ticker, no_bid)