import asyncio
import ctypes
import json
import logging
import sys
import time
from apscheduler.triggers.cron import CronTrigger
import websockets
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from strategies.telegram_notifier import TelegramNotifier
from strategies.kalshi_crypto.config import CryptoJobConfig
from strategies.kalshi_client import KalshiClient
from strategies.kalshi_crypto.crypto_order_book import CryptoOrderBook
from strategies.kalshi_crypto.supabase_logger import SupabaseLogger
from strategies.kalshi_crypto.market_state import get_current_15m_market_ticker, get_next_15m_market_ticker, get_last_closed_15m_market_ticker
from strategies.kalshi_crypto.util import ts_ms_to_time_str, countdown_15m, seconds_to_next_15m

class _CountdownAdapter(logging.LoggerAdapter):
    """Prepends [MM:SS] countdown to every log message automatically."""
    def process(self, msg, kwargs):
        return f"{countdown_15m()} {msg}", kwargs

logger = _CountdownAdapter(logging.getLogger(__name__), {})

# Signal levels (evaluated per-tick, fired once each per market window)
SIGNAL_DWI_THRESHOLD = 0.5      # Level 1: |DWI| > 0.5 + contract imbalance agrees
SIGNAL_DWI_SUSTAINED = 0.7      # Level 2: |DWI| > 0.7 sustained for 60s
SIGNAL_DWI_STRONG = 0.9         # Level 3: |DWI| > 0.9
SIGNAL_COMPOSITE_THRESHOLD = 0.5  # Level 4: all three metrics aligned + |DWI| > 0.5
SUSTAINED_SECONDS = 60

def _same_sign(a: float, b: float) -> bool:
    return (a > 0 and b > 0) or (a < 0 and b < 0)


def _prevent_sleep():
    """Tell Windows to keep the system awake while the bot runs. No-op on other OSes."""
    if sys.platform != "win32":
        return
    ES_CONTINUOUS = 0x80000000
    ES_SYSTEM_REQUIRED = 0x00000001
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
    logger.info("Windows sleep prevention enabled")


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

        # Per-ticker signal snapshots: { ticker: { "L1": {details}, "L2": {details}, ... } }
        self._signals: dict[str, dict[str, dict]] = {}
        self._dwi_sustained: dict[str, float | None] = {}
        # Per-ticker actual trade: set on L1 signal, consumed by ticker_cleanup
        self._trades: dict[str, dict] = {}

    async def start(self):
        """
        Stream ticker data via WebSocket for one 15-min window.

        Reconnects automatically if the WS connection drops.  Exits when
        the market close time is reached.
        """
        _prevent_sleep()

        self.initialize()
        channels = ["orderbook_delta"]

        self.scheduler.start()

        while True:
            try:
                async with self._client.connect_ws() as ws:
                    self._reset_scheduler_jobs(ws)

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

    def _reset_scheduler_jobs(self, ws):
        """Replace scheduler jobs with fresh ones pointing at the new WS connection."""
        self.scheduler.remove_all_jobs()
        self.scheduler.add_job(self.subscribe_next_ticker, args=[ws], trigger=CronTrigger(minute='14,29,44,59', second=59))
        self.scheduler.add_job(self.unsubscribe_last_closed_ticker, args=[ws], trigger=CronTrigger(minute='0,15,30,45', second=30))

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
                        asyncio.get_event_loop().create_task(self.ticker_cleanup(ticker))
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
            self._signals[market_ticker] = {}
            self._dwi_sustained[market_ticker] = None
            logger.info(f"Create New Orderbook for {market_ticker}")

    def process_orderbook_delta(self, response: dict):
        msg = response.get("msg")
        market_ticker = msg.get("market_ticker")
        book = self.books[market_ticker]
        book.apply_delta(msg)

        seconds_left = seconds_to_next_15m()
        if seconds_left > 60 * 10:
            return

        if not book.is_stable(self.cfg.spread):
            return

        ts = ts_ms_to_time_str(msg.get("ts_ms"))
        dwi = book.dollar_weighted_imbalance()
        ci = book.contract_imbalance()
        ndi = book.normalized_dollar_imbalance()
        abs_dwi = abs(dwi)
        sigs = self._signals.setdefault(market_ticker, {})
        direction = "yes" if dwi > 0 else "no"

        def _snap() -> dict:
            return {
                "ts": ts,
                "direction": direction,
                "dwi": dwi, "ci": ci, "ndi": ndi,
                "yes_ask": book.yes_ask, "no_ask": book.no_ask,
                "yes_bid": book.best_yes_bid, "no_bid": book.best_no_bid,
                "entry_price": book.yes_ask if direction == "YES" else book.no_ask,
                "side": "yes" if direction == "YES" else "no",
            }

        # --- Signal 1: |DWI| > 0.5 AND contract imbalance agrees ---
        if "L1" not in sigs:
            if abs_dwi > SIGNAL_DWI_THRESHOLD and _same_sign(dwi, ci):
                sigs["L1"] = _snap()
                logger.info(
                    f"SIGNAL L1 [{market_ticker}] @{ts}  "
                    f"direction={direction}  DWI={dwi:+.4f} CI={ci:+.4f}  "
                    f"{book.imbalance_log(ts=ts)}"
                )
                # self._telegram.send(
                #     f"<b>L1 Signal: |DWI|>0.5 + CI agrees @{ts}</b>\n"
                #     f"<b>{market_ticker}</b> -> <b>{direction}</b>\n"
                #     f"DWI={dwi:+.4f}  CI={ci:+.4f}\n"
                #     f"yes={book.best_yes_bid:.2f}/{book.yes_ask:.2f}  "
                #     f"no={book.best_no_bid:.2f}/{book.no_ask:.2f}"
                # )
                self._try_enter(market_ticker, book, direction, ts, dwi, ci, ndi, reverse=True)

        # --- Signal 2: |DWI| > 0.7 sustained for 60s ---
        if "L2" not in sigs:
            sustained_since = self._dwi_sustained.get(market_ticker)
            now = time.monotonic()
            if abs_dwi > SIGNAL_DWI_SUSTAINED:
                if sustained_since is None:
                    self._dwi_sustained[market_ticker] = now
                elif now - sustained_since >= SUSTAINED_SECONDS:
                    sigs["L2"] = _snap()
                    logger.info(
                        f"SIGNAL L2 [{market_ticker}] @{ts}  "
                        f"direction={direction}  DWI={dwi:+.4f} sustained>{SUSTAINED_SECONDS}s"
                    )
            else:
                self._dwi_sustained[market_ticker] = None

        # --- Signal 3: |DWI| > 0.9 ---
        if "L3" not in sigs:
            if abs_dwi > SIGNAL_DWI_STRONG:
                sigs["L3"] = _snap()
                logger.info(
                    f"SIGNAL L3 [{market_ticker}] @{ts}  "
                    f"direction={direction}  DWI={dwi:+.4f}"
                )

        # --- Signal 4: All three metrics aligned + |DWI| > 0.5 ---
        if "L4" not in sigs:
            if abs_dwi > SIGNAL_COMPOSITE_THRESHOLD and _same_sign(dwi, ci) and _same_sign(dwi, ndi):
                sigs["L4"] = _snap()
                logger.info(
                    f"SIGNAL L4 [{market_ticker}] @{ts}  "
                    f"direction={direction}  DWI={dwi:+.4f} CI={ci:+.4f} NDI={ndi:+.4f}"
                )

    def process_market_ticker(self, response: dict):
        pass

    async def subscribe_next_ticker(self, ws: websockets.WebSocketClientProtocol):
        next_ticker = get_next_15m_market_ticker(self.cfg.series)
        await self._client.ws_add_markets(ws, self.orderbook_delta_sid, market_ticker=next_ticker)
        logger.info(f"Subscribe to next ticker: {next_ticker}")

    async def unsubscribe_last_closed_ticker(self, ws: websockets.WebSocketClientProtocol):
        last_closed_ticker = get_last_closed_15m_market_ticker(self.cfg.series)
        await self._client.ws_delete_markets(ws, self.orderbook_delta_sid, market_ticker=last_closed_ticker)
        logger.info(f"Unsubscribe from last closed ticker: {last_closed_ticker}")
    
    async def ticker_cleanup(self, ticker: str):
        sigs = self._signals.get(ticker, {})
        trade = self._trades.get(ticker)
        market = await self._client.get_market(ticker)
        balance = await self._client.get_balance()

        if not market or market.get("status") != "finalized":
            logger.error(f"Market {ticker} not finalized yet")
            self._telegram.send(
                f"Market {ticker} not finalized — cannot compute result\n" + 
                f"Current balance: ${balance:.2f}")
            self._cleanup_state(ticker)
            return

        result = market.get("result")  # "yes" or "no"
        sig_names = sorted(sigs.keys())
        logger.info(f"END OF WINDOW [{ticker}]  result={result}  signals={sig_names}")

        lines = [f"<b>Window: {ticker}</b>", f"Result: <b>{result.upper()}</b>"]

        # --- Actual trade (L1) ---
        if trade:
            side = trade["side"]
            entry = float(trade["entry_price"])
            won = (side == result)
            pnl = ((1.0 - entry) if won else -entry) * self.cfg.count
            pnl_label = f"+${pnl:.2f}" if pnl >= 0 else f"-${abs(pnl):.2f}"

            order_id = trade.get("order_id")
            order_final_status = trade.get("order_status")
            if order_id:
                order = await self._client.get_order(order_id)
                if order:
                    order_final_status = order.get("status")

            lines.append("")
            lines.append(f"<b>ACTUAL TRADE (L1)</b>")
            lines.append(f"  {side.upper()} @ ${entry:.2f} x{self.cfg.count}")
            lines.append(f"  Order: {order_id} ({order_final_status})")
            lines.append(f"  P&L: <b>{pnl_label} ({'WIN' if won else 'LOSS'})</b>")

            logger.info(
                f"TRADE [{ticker}] {side.upper()} @ ${entry:.2f}  "
                f"result={result}  {'WIN' if won else 'LOSS'}  pnl={pnl_label}  "
                f"order={order_id} ({order_final_status})"
            )
        else:
            lines.append("")
            lines.append("No trade placed")

        # --- All signals (actual + hypothetical) ---
        lines.append("")
        lines.append("<b>Signal Details:</b>")
        
        stats_data = {"ticker": ticker}
        
        for level in ["L1", "L2", "L3", "L4"]:
            snap = sigs.get(level)
            if not snap:
                lines.append(f"  {level}: not fired")
                stats_data[f"{level.lower()}_detected_time"] = None
                stats_data[f"{level.lower()}_net_profit"] = None
                continue

            s_side = snap["side"]
            s_entry = snap["entry_price"]
            s_won = (s_side == result)
            s_pnl = ((1.0 - s_entry) if s_won else -s_entry) * self.cfg.count

            stats_data[f"{level.lower()}_detected_time"] = snap["ts"]
            stats_data[f"{level.lower()}_net_profit"] = s_pnl

            s_pnl_label = f"+${s_pnl:.2f}" if s_pnl >= 0 else f"-${abs(s_pnl):.2f}"
            is_actual = (level == "L1" and trade)

            lines.append(
                f"  {level}: {snap['direction']} @ ${s_entry:.2f} "
                f"[{s_pnl_label} {'WIN' if s_won else 'LOSS'}] "
                f"{'(TRADED)' if is_actual else '(hypothetical)'}"
            )
            lines.append(
                f"    @{snap['ts']}  DWI={snap['dwi']:+.4f} CI={snap['ci']:+.4f} NDI={snap['ndi']:+.4f}"
            )

        if self._db:
            logger.info(f"Logging ticker stats: {stats_data}")
            await self._db.log_ticker_stats(stats_data)
        else:
            logger.info("No DB connected, skipping ticker stats logging")

        lines.append(f"Current balance: ${balance:.2f}")
        self._telegram.send("\n".join(lines))
        self._cleanup_state(ticker)

    def _cleanup_state(self, ticker: str):
        self.books.pop(ticker, None)
        self._signals.pop(ticker, None)
        self._dwi_sustained.pop(ticker, None)
        self._trades.pop(ticker, None)

    # ── Entry (hold-to-expiry) ───────────────────────────────────────────

    def _try_enter(
        self, ticker: str, book: CryptoOrderBook,
        direction: str, ts: str,
        dwi: float, ci: float, ndi: float,
        reverse: bool = False
    ):
        """Attempt a contrarian trade — fade the L1 signal direction."""
        if ticker in self._trades:
            logger.info(f"SKIP ENTRY [{ticker}] — already traded this window")
            return

        if reverse:
            if direction == "yes":
                side = "no"
            else:
                side = "yes"
        else:
            side = direction

        entry_price = f"{book.yes_ask:.2f}" if side == 'yes' else f"{book.no_ask:.2f}"

        entry_float = float(entry_price)
        if entry_float >= 0.95:
            logger.info(f"SKIP ENTRY [{ticker}] {side} @ ${entry_price} — price too high, limited upside")
            return

        self._trades[ticker] = {
            "side": side,
            "direction": direction,
            "entry_price": entry_price,
            "signal": "L1_DWI_CONTRACT",
            "signal_ts": ts,
            "dwi": dwi,
            "ci": ci,
            "ndi": ndi,
            "order_id": None,
            "order_status": None,
        }
        logger.info(f"ENTERING [{ticker}] {side.upper()} @ ${entry_price}")
        asyncio.get_event_loop().create_task(self._enter(ticker))

    async def _enter(self, ticker: str):
        trade = self._trades.get(ticker)
        if not trade:
            return

        side = trade["side"]
        ask_price = trade["entry_price"]
        logger.info(f"[{ticker}] {side.upper()} @ {ask_price}$ — placing order")

        buy = None
        if side == 'yes':
            buy = await self._client.place_order(ticker, side, action="buy", count=self.cfg.count, yes_price_dollars=ask_price)
        else:
            buy = await self._client.place_order(ticker, side, action="buy", count=self.cfg.count, no_price_dollars=ask_price)

        if not buy:
            logger.error(f"Buy order failed for {ticker} {side}")
            trade["order_status"] = "failed"
            return

        trade["order_id"] = buy.get("order_id")
        trade["order_status"] = buy.get("status")

        # self._telegram.send(
        #     f"<b>SUCCESSFULLY ENTERED [{ticker}] {side.upper()} @ {ask_price}$ x{self.cfg.count}</b>\n"
        #     f"Order: {buy.get('order_id')} ({buy.get('status')})\n"
        #     f"Hold to expiry — settles at $1 or $0"
        # )
