import asyncio
import json
import logging
import time
from datetime import datetime, timezone

import websockets

from strategies.telegram_notifier import TelegramNotifier
from strategies.kalshi_crypto.config import CryptoJobConfig
from strategies.kalshi_client import KalshiClient
from strategies.kalshi_crypto.supabase_logger import SupabaseLogger
from strategies.kalshi_crypto.market_state import get_current_15m_market_ticker
from strategies.util import convert_utc_to_ny

logger = logging.getLogger(__name__)

ORDER_CHECK_INTERVAL = 5  # seconds between REST order-status polls


class Crypto15mJob:
    """
    Encapsulates all trading logic for one crypto series over a 15-min window.

    Uses a WebSocket `ticker` subscription for real-time market data instead of
    REST polling, avoiding 429 rate-limit errors. REST is only used for
    order placement, cancellation, and periodic order-status checks.
    """

    def __init__(
        self,
        cfg: CryptoJobConfig,
        client: KalshiClient,
        db: SupabaseLogger | None,
        telegram: TelegramNotifier,
        use_demo: bool = False,
    ):
        self.cfg = cfg
        self._client = client
        self._db = db
        self._telegram = telegram
        self._use_demo = use_demo
        self._active_trade: dict | None = None
        self.ticker: str = ""
        self.close_time: int = 0
        self.subscribed_ids: list[int] = []
        self.state: str = 'ready'

    async def run(self):
        """
        Stream ticker data via WebSocket for one 15-min window.

        Reconnects automatically if the WS connection drops.  Exits when
        the market close time is reached.
        """
        
        self.initialize()
        channels = ["ticker", "orderbook_delta"]

        while True:
            try:
                async with self._client.connect_ws() as ws:
                    await self._client.ws_subscribe(ws, channels, market_ticker=self.ticker, send_initial_snapshot=True)
                    logger.info(f"WebSocket subscribed to [{self.ticker}]")

                    async for message in ws:
                        result = self.process_message(message)
                        if result == 'Unsubscribe':
                            await self._client.ws_unsubscribe(ws, self.subscribed_ids)
                            self.initialize()
                            await self._client.ws_subscribe(ws, channels, market_ticker=self.ticker, send_initial_snapshot=True)
                            logger.info(f"WebSocket subscribed to [{self.ticker}]")

            except (websockets.ConnectionClosed, ConnectionError) as e:
                logger.warning(f"[{self.ticker}] WS disconnected ({e}), reconnecting...")
                await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"[{self.ticker}] WS error: {e}", exc_info=True)
                await asyncio.sleep(2)

        end_balance = await self._client.get_balance()
        profit = end_balance - start_balance
        logger.info(f"[{ticker}] {start_balance} → {end_balance} Profit: ${profit:.2f}")
        await self._telegram.send(f"💰 [{ticker}] {start_balance} → {end_balance} Profit: ${profit:.2f}")

    def initialize(self):
        self.ticker, self.close_time = get_current_15m_market_ticker(self.cfg.series)
        self.subscribed_ids = []
        self.state = 'ready'

    def process_message(self, message: str):
        response = json.loads(message)
        if response.get("type") == "subscribed":
            return self.process_subscribed(response)
        elif response.get("type") == "ticker":
            return self.process_market_ticker(response)
        elif response.get("type") == "orderbook_delta":
            return self.process_orderbook_delta(response)
        else:
            logger.info(f"[SPECIAL] {response}")

    def process_subscribed(self, response: dict):
        self.subscribed_ids.append(response.get('msg', {}).get('sid'))
        logger.info(f"[{self.ticker}] WebSocket Subscription IDs: {self.subscribed_ids}")
        return None

    def process_orderbook_snapshot(self, response: dict):
        pass

    def process_orderbook_delta(self, response: dict):
        # {'market_ticker': 'KXBTC15M-26APR210900-00', 'market_id': '5adb0651-edb4-490e-8909-49825428bf1e', 'price_dollars': '0.3400', 'delta_fp': '142.00', 'side': 'no', 'ts': '2026-04-21T12:52:15.63042Z'}
        msg = response.get('msg')
        price_dollars = float(msg.get('price_dollars'))
        delta_fp = float(msg.get('delta_fp'))
        side = msg.get('side')
        ts = msg.get('ts')
        # logger.info(f"[{self.ticker}] Orderbook Delta: {ts} price_dollars=${price_dollars} delta_fp={delta_fp} side={side}")
        return None

    def process_market_ticker(self, response: dict):
        msg = response.get('msg')

        if self.state == 'ready':
            return None

        price_dollars = float(msg.get('price_dollars'))
        yes_ask_dollars = float(msg.get('yes_ask_dollars'))
        yes_bid_dollars = float(msg.get('yes_bid_dollars'))
        no_ask_dollars = 1 - yes_bid_dollars
        no_bid_dollars = 1 - yes_ask_dollars
        ts = int(msg.get('ts'))
        time = msg.get('time')

        # logger.info(f"{msg}")
        # logger.info(f"[{self.ticker}] Price: ${price_dollars} Yes Ask: ${yes_ask_dollars} Yes Bid: ${yes_bid_dollars} No Ask: ${no_ask_dollars} No Bid: ${no_bid_dollars} TS: {ts} Time: {time}")

        difference = self.close_time - ts
        # logger.info(f"[{self.ticker}] Time difference: {difference} seconds, price: ${price_dollars}")

        if self.close_time <= ts:
            return 'Unsubscribe'

        return None

    def attempt_buy(self, response: dict):
        msg = response.get('msg')
        price_dollars = float(msg.get('price_dollars'))
        yes_ask_dollars = float(msg.get('yes_ask_dollars'))
        yes_bid_dollars = float(msg.get('yes_bid_dollars'))
        no_ask_dollars = 1 - yes_bid_dollars
        no_bid_dollars = 1 - yes_ask_dollars
        ts = int(msg.get('ts'))
        time = msg.get('time')

        yes_in_zone = self.cfg.entry_dollars <= yes_ask_dollars <= self.cfg.target_dollars
        no_in_zone = self.cfg.entry_dollars <= no_ask_dollars <= self.cfg.target_dollars
        spread = yes_ask_dollars - yes_bid_dollars

        if yes_in_zone:
            # try to buy yes
            pass
        
        if no_in_zone:
            # try to buy no
            pass

        return None

    async def _tick(self, ticker: str, secs_left: float, market: dict):
        if self._active_trade:
            if self._active_trade.get("status") == "sell_resting":
                await self._check_stop_loss(ticker, market)
            return

        yes_ask = market.get("yes_ask_dollars")
        yes_bid = market.get("yes_bid_dollars")
        no_ask  = market.get("no_ask_dollars")
        no_bid  = market.get("no_bid_dollars")

        yes_price = float(yes_ask)
        no_price = float(no_ask)

        yes_in_zone = self.cfg.entry_dollars <= yes_price <= self.cfg.target_dollars
        no_in_zone  = self.cfg.entry_dollars <= no_price  <= self.cfg.target_dollars

        logger.info(f"[{ticker}] yes_bid={yes_bid}$ yes_ask={yes_ask}$ no_bid={no_bid}$ no_ask={no_ask}$ yes_in_zone={yes_in_zone} no_in_zone={no_in_zone}")

        if yes_in_zone or no_in_zone:
            side_label = f"YES={yes_ask}$ IN ZONE" if yes_in_zone else f"NO={no_ask}$ IN ZONE"
            logger.info(
                f"{ticker}  YES bid={yes_bid}$ ask={yes_ask}$  "
                f"NO bid={no_bid}$ ask={no_ask}$  "
                f"{secs_left:.0f}s left  ✓ {side_label}"
            )
            side = "yes" if yes_in_zone else "no"
            ask_price = yes_ask if yes_in_zone else no_ask
            await self._enter(ticker, side, ask_price, secs_left)
        else:
            logger.debug(
                f"{ticker}  YES ask={yes_ask}$  NO ask={no_ask}$  "
                f"{secs_left:.0f}s left  "
                f"(want {self.cfg.entry_dollars}$)"
            )

    # ── Order-status polling (REST, every ORDER_CHECK_INTERVAL seconds) ───

    async def _poll_order_status(self, ticker: str):
        if not self._active_trade:
            return

        status = self._active_trade.get("status")

        if status == "buy_resting":
            order_id = self._active_trade["buy_order"]["order_id"]
            buy_order = await self._client.get_order(order_id)
            if buy_order and buy_order.get("status") != "resting":
                logger.info(f"[{self.cfg.series}] {ticker} Buy order filled")
                self._active_trade["status"] = "buy_executed"
                await self.take_profit_leave(
                    ticker,
                    self._active_trade["side"],
                    self._active_trade["entry_price"],
                )

        elif status == "sell_resting":
            order_id = self._active_trade["sell_order"]["order_id"]
            sell_order = await self._client.get_order(order_id)
            if sell_order and sell_order.get("status") == "executed":
                logger.info(f"[{self.cfg.series}] {ticker} Sell order filled")
                await self._telegram.send(
                    f"✅Take profit {ticker} {self._active_trade['side']} "
                    f"@ {self._active_trade['entry_price']}¢ "
                    f"[{sell_order.get('order_id')}] on "
                    f"{convert_utc_to_ny(sell_order.get('created_time'))}"
                )
                self._active_trade = None

    # ── Stop-loss check (uses WS market data, no REST call) ──────────────

    async def _check_stop_loss(self, ticker: str, market: dict):
        if not self._active_trade or self._active_trade.get("status") != "sell_resting":
            return

        side = self._active_trade["side"]
        stop_loss_price = self._active_trade.get("stop_loss_price")

        if side == "yes":
            current_price = float(market.get("yes_ask_dollars", "1.00"))
            current_bid = market.get("yes_bid_dollars")
        else:
            current_price = float(market.get("no_ask_dollars", "1.00"))
            current_bid = market.get("no_bid_dollars")

        if current_price < stop_loss_price:
            await self._stop_loss_exit(ticker, current_bid)

    # ── Entry ─────────────────────────────────────────────────────────────

    async def _enter(self, ticker: str, side: str, ask_price: str, secs_left: float):
        logger.info(f"[{ticker}] {side.upper()} @ {ask_price}$ {secs_left:.0f}s left — entering")

        buy = None
        if side == 'yes':
            buy = await self._client.place_order(ticker, side, action="buy", count=self.cfg.count, yes_price_dollars=ask_price)
        else:
            buy = await self._client.place_order(ticker, side, action="buy", count=self.cfg.count, no_price_dollars=ask_price)
        if not buy:
            logger.error(f"Buy order failed for {ticker} {side}")
            return

        if buy.get("status") == "resting":
            logger.error(f"Buy order {buy.get('order_id')} is resting for {ticker} {side}")
            await self._telegram.send(f"⏳Pending {ticker} {side} @ {ask_price}¢ [{buy.get('order_id')}] on {convert_utc_to_ny(buy.get('created_time'))}")
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

    async def take_profit_leave(self, ticker: str, side: str, start_price: str):
        env_tag = "[DEMO]" if self._use_demo else "[LIVE]"
        start_price_float = float(start_price)
        take_profit_price = f'{min(start_price_float + 0.05, 0.99):.2f}'

        sell = None
        if side == 'yes':
            sell = await self._client.place_order(ticker, side, action="sell", count=self.cfg.count, yes_price_dollars=take_profit_price)
        else:
            sell = await self._client.place_order(ticker, side, action="sell", count=self.cfg.count, no_price_dollars=take_profit_price)

        if sell.get("status") == "executed":
            await self._telegram.send(f"✅Take profit {ticker} {side} @ {take_profit_price}¢ [{sell.get('order_id')}] on {convert_utc_to_ny(sell.get('created_time'))}")
            self._active_trade = None
            return

        await self._telegram.send(
            f"<b>[{ticker}] Scalp Signal {env_tag}</b>\n"
            f"<b>{side.upper()}</b> <b>{start_price}$</b> → <b>{take_profit_price}$</b>\n"
            f"Counts: {self.cfg.count} | cost ~${start_price_float * self.cfg.count:.2f}\n"
            f"Buy order placed @ {convert_utc_to_ny(self._active_trade['buy_order'].get('created_time'))}\n"
            f"Take profit order placed @ {convert_utc_to_ny(sell.get('created_time'))}\n"
        )

        stop_loss_price = start_price_float - 0.05
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
                count=self.cfg.count,
                price_per_contract=start_price_float,
                total_cost=round(start_price_float * self.cfg.count, 2),
                kalshi_order_id=sell.get("order_id", "") if sell else "failed",
                status="open",
            )
            await self._db.log_bet(bet)

    # ── Stop-loss exit ────────────────────────────────────────────────────

    async def _stop_loss_exit(self, ticker: str, current_bid: str):
        side = self._active_trade.get("side")
        entry_price = float(self._active_trade.get("entry_price", 0))
        sell_order = self._active_trade.get("sell_order")
        sell_id = sell_order.get("order_id")

        # Guard: check if the take-profit already filled before cancelling
        if sell_id:
            latest = await self._client.get_order(sell_id)
            if latest and latest.get("status") == "executed":
                logger.info(f"[{ticker}] Take-profit already filled — skipping stop loss")
                await self._telegram.send(
                    f"✅Take profit {ticker} {side} @ {self._active_trade['entry_price']}¢ "
                    f"[{sell_id}] on {convert_utc_to_ny(latest.get('created_time'))}"
                )
                self._active_trade = None
                return

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
                await self._telegram.send(f"❌ Fail to cancel {ticker} {side} @ {entry_price}¢ [{sell_id}] on {convert_utc_to_ny(sell_order.get('created_time'))}")

        stop_loss_price = self._active_trade.get("stop_loss_price")
        exit_price = f'{stop_loss_price:.2f}'
        stop_sell = None
        if side == 'yes':
            stop_sell = await self._client.place_order(ticker, side, "sell", self.cfg.count, yes_price_dollars=exit_price)
        else:
            stop_sell = await self._client.place_order(ticker, side, "sell", self.cfg.count, no_price_dollars=exit_price)

        if stop_sell.get("status") == "executed":
            await self._telegram.send(f"❌Take profit {ticker} {self._active_trade['side']} @ {self._active_trade['entry_price']}¢ [{sell_order.get('order_id')}] on {convert_utc_to_ny(sell_order.get('created_time'))}")
        else:
            await self._telegram.send(f"❌Stop loss pending {ticker} {side} @ {exit_price}$ [{stop_sell.get('order_id') if stop_sell else 'failed'}]")
        stop_sell_id = stop_sell.get("order_id", "") if stop_sell else "failed"

        loss_cents = (entry_price - stop_loss_price) * self.cfg.count
        logger.warning(
            f"[{self.cfg.series}] {ticker} stop-sell placed @ {exit_price}$  id={stop_sell_id}  "
            f"loss ~${loss_cents:.2f}"
        )

        env_tag = " [DEMO]" if self._use_demo else ""
        await self._telegram.send(
            f"<b>[{self.cfg.series}] Stop Loss Hit{env_tag}</b>\n"
            f"Market: {ticker}\n"
            f"Side: {side.upper()} | Entry: {entry_price}$ → Stop: {exit_price}$\n"
            f"Loss: ~${loss_cents:.2f}  |  order={stop_sell_id}"
        )

        self._active_trade = None
