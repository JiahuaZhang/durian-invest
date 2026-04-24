import asyncio
import json
import logging
from apscheduler.triggers.cron import CronTrigger
import websockets
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from strategies.telegram_notifier import TelegramNotifier
from strategies.kalshi_crypto.config import CryptoJobConfig
from strategies.kalshi_client import KalshiClient
from strategies.kalshi_crypto.crypto_order_book import CryptoOrderBook
from strategies.kalshi_crypto.supabase_logger import SupabaseLogger
from strategies.kalshi_crypto.market_state import get_current_15m_market_ticker, get_next_15m_market_ticker, get_last_closed_15m_market_ticker
from strategies.util import convert_utc_to_ny
from strategies.kalshi_crypto.util import from_iso_to_ts

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

        self.tickers: list[str] = []
        self.orderbook_delta_sid: int = 0
        self.books: dict[str, CryptoOrderBook] = {}
        self.scheduler = AsyncIOScheduler()
        self.state : str = 'ready'
        self._active_trade: dict | None = None

    async def start(self):
        """
        Stream ticker data via WebSocket for one 15-min window.

        Reconnects automatically if the WS connection drops.  Exits when
        the market close time is reached.
        """
        
        self.initialize()
        # ticker, orderbook_delta, market_positions, market_lifecycle_v2, multivariate_market_lifecycle, multivariate, communications, order_group_updates, user_orders
        channels = ["orderbook_delta"]

        while True:
            try:
                async with self._client.connect_ws() as ws:
                    self.scheduler.remove_all_jobs()
                    self.scheduler.add_job(self.subscribe_next_ticker, args=[ws], trigger=CronTrigger(minute='14, 29, 44, 59', second=59))
                    self.scheduler.add_job(self.unsubscribe_last_closed_ticker, args=[ws], trigger=CronTrigger(minute='0, 15, 30, 45'))
                    self.scheduler.start()

                    await self._client.ws_subscribe(ws, channels, market_tickers=self.tickers, send_initial_snapshot=True)
                    logger.info(f"Init webSocket subscribed to {self.tickers}")

                    async for message in ws:
                        self.process_message(message)

            except (websockets.ConnectionClosed, ConnectionError) as e:
                logger.warning(f"WebSocket connection closed ({e}), reconnecting...")
                await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"WebSocket error: {e}", exc_info=True)
                await asyncio.sleep(2)

        end_balance = await self._client.get_balance()
        profit = end_balance - start_balance
        logger.info(f"[{ticker}] {start_balance} → {end_balance} Profit: ${profit:.2f}")
        await self._telegram.send(f"💰 [{ticker}] {start_balance} → {end_balance} Profit: ${profit:.2f}")

    def initialize(self):
        self.tickers = [get_current_15m_market_ticker(self.cfg.series)]

    def process_message(self, message: str):
        response = json.loads(message)
        match response.get('type'):
            case 'ok':
                return self.process_ok(response)
            case 'error':
                return self.process_error(response)
            case "subscribed":
                return self.process_subscribed(response)
            case "unsubscribed":
                return self.process_unsubscribed(response)
            case "ticker":
                return self.process_market_ticker(response)
            case "orderbook_delta":
                return self.process_orderbook_delta(response)
            case "orderbook_snapshot":
                return self.process_orderbook_snapshot(response)
            case _:
                logger.info(f"[UNKNOWN] {response}")

    def process_ok(self, response: dict):
        msg = response.get('msg')
        if isinstance(msg, list):
            channels = [f"{item['channel']}: {item['sid']}" for item in msg]
            logger.info(f"List subscriptions: {channels}")
        elif isinstance(msg, dict):
            market_tickers = msg.get('market_tickers')
            if market_tickers:
                logger.info(f"Ok Response for market_tickers: {market_tickers}")
                for ticker in list[str](self.books.keys()):
                    if ticker not in market_tickers:
                        del self.books[ticker]
                        logger.info(f"Delete Orderbook for {ticker} because it is not in the new market_tickers")
            else:
                logger.info(f"[UNKNOWN] Ok Response: {msg}")

    def process_error(self, response: dict):
        msg = response.get('msg')
        logger.error(f"WebSocket Error: [{msg.get('code')}] {msg.get('msg')}")

    def process_subscribed(self, response: dict):
        msg = response.get('msg')
        channel = msg.get('channel')
        sid = msg.get('sid')
        if channel == 'orderbook_delta':
            self.orderbook_delta_sid = sid
            logger.info(f"orderbook_delta channel sid: {sid}")
        else:
            logger.error(f"[UNKNOWN] unhandled channel: {channel}")
    
    def process_unsubscribed(self, response: dict):
        logger.info(f"Unsubscribed id: {response.get('id')} sid: {response.get('sid')} seq: {response.get('seq')}")

    def process_orderbook_snapshot(self, response: dict):
        msg = response.get("msg")
        market_ticker = msg.get("market_ticker")
        seq = response.get("seq", 0)
        if market_ticker not in self.books:
            self.books[market_ticker] = CryptoOrderBook()
            self.books[market_ticker].load_snapshot(msg, seq=seq)
            logger.info(f"Create New Orderbook for {market_ticker}")
            logger.info(f"Orderbook Snapshot: {msg}")
        else:
            # seems like Kalshi websocket would send snapshot when subscribed to new tocker
            # the old one would still received it, use this mechanism to smartly delete the old one
            pass

    def process_orderbook_delta(self, response: dict):
        msg = response.get("msg")
        market_ticker = msg.get("market_ticker")
        book = self.books[market_ticker]
        book.apply_delta(msg)

        if self.state == 'ready':
            if self.cfg.entry_dollars <= book.yes_ask <= self.cfg.target_dollars:
                spread_status = 'TIGHT' if book.yes_spread <= 0.01 else 'MODERATE' if book.yes_spread <= 0.02 else 'RISKY'
                fillable_contracts = book.ask_depth_up_to('yes', self.cfg.entry_dollars)
                conviction_contracts = book.depth_at('yes', self.cfg.entry_dollars)
                take_profit_contracts = book.bid_depth_above('yes', self.cfg.target_dollars)
                stop_safe_contracts = book.bid_depth_above('yes', self.cfg.stop_loss_dollars)
                logger.info(
                    f"BUY YES for {market_ticker} yes_ask: {book.yes_ask} best_yes_bid: {book.best_yes_bid} yes_spread: {book.yes_spread} " +
                    f"no_ask: {book.no_ask} best_no_bid: {book.best_no_bid} no_spread: {book.no_spread} " +
                    f"Spread: {spread_status} Fillable <= ${self.cfg.entry_dollars}: {fillable_contracts} Conviction = ${self.cfg.entry_dollars}: {conviction_contracts} " +
                    f"Take Profit >= ${self.cfg.target_dollars}: {take_profit_contracts} contracts Stop Safe >= ${self.cfg.stop_loss_dollars}: {stop_safe_contracts} contracts"
                )
            elif self.cfg.entry_dollars <= book.no_ask <= self.cfg.target_dollars:
                spread_status = 'TIGHT' if book.no_spread <= 0.01 else 'MODERATE' if book.no_spread <= 0.02 else 'RISKY'
                fillable_contracts = book.ask_depth_up_to('no', self.cfg.entry_dollars)
                conviction_contracts = book.depth_at('no', self.cfg.entry_dollars)
                take_profit_contracts = book.bid_depth_above('no', self.cfg.target_dollars)
                stop_safe_contracts = book.bid_depth_above('no', self.cfg.stop_loss_dollars)
                logger.info(
                    f"BUY NO for {market_ticker} no_ask: {book.no_ask} best_no_bid: {book.best_no_bid} no_spread: {book.no_spread} " +
                    f"yes_ask: {book.yes_ask} best_yes_bid: {book.best_yes_bid} yes_spread: {book.yes_spread} " +
                    f"Spread: {spread_status} Fillable <= ${self.cfg.entry_dollars}: {fillable_contracts} Conviction = ${self.cfg.entry_dollars}: {conviction_contracts} " +
                    f"Take Profit >= ${self.cfg.target_dollars}: {take_profit_contracts} contracts Stop Safe >= ${self.cfg.stop_loss_dollars}: {stop_safe_contracts} contracts"
                )

    def process_market_ticker(self, response: dict):
        msg = response.get('msg')

        price_dollars = float(msg.get('price_dollars'))
        yes_ask_dollars = float(msg.get('yes_ask_dollars'))
        yes_bid_dollars = float(msg.get('yes_bid_dollars'))
        no_ask_dollars = 1 - yes_bid_dollars
        no_bid_dollars = 1 - yes_ask_dollars
        ts = int(msg.get('ts'))
        time = msg.get('time')

        # logger.info(f"{msg}")
        # logger.info(f"[{self.ticker}] Price: ${price_dollars} Yes Ask: ${yes_ask_dollars} Yes Bid: ${yes_bid_dollars} No Ask: ${no_ask_dollars} No Bid: ${no_bid_dollars} TS: {ts} Time: {time}")

    async def subscribe_next_ticker(self, ws: websockets.WebSocketClientProtocol):
        next_ticker = get_next_15m_market_ticker(self.cfg.series)
        await self._client.ws_add_markets(ws, self.orderbook_delta_sid, market_ticker=next_ticker)
        logger.info(f"Subscribe to next ticker: {next_ticker}")

    async def unsubscribe_last_closed_ticker(self, ws: websockets.WebSocketClientProtocol):
        last_closed_ticker = get_last_closed_15m_market_ticker(self.cfg.series)
        await self._client.ws_delete_markets(ws, self.orderbook_delta_sid, market_ticker=last_closed_ticker)
        logger.info(f"Unsubscribe from last closed ticker: {last_closed_ticker}")

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
