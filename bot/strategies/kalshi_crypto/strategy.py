"""
Kalshi BTC 15-min scalp bot.

Strategy: follow the conviction trend — when either YES or NO has an ask in the
85-92¢ zone, the market has 85-92% confidence it will resolve that way.  Buy
that side at market ask, place a resting limit sell at 97¢, and exit via stop
loss at 88¢ if the bid turns against us.

Required env vars:
  use-demo: false  →  KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY       (production)
  use-demo: true   →  KALSHI_DEMO_KEY_ID + KALSHI_DEMO_PRIVATE_KEY (demo.kalshi.co)

Optional:
  SUPABASE_URL, SUPABASE_SERVICE_KEY  — bet logging
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — notifications
"""
import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv

from ..base_strategy import TradingStrategy
from ..registry import StrategyRegistry
from ..telegram_notifier import TelegramNotifier
from .config import BtcScalpConfig
from .kalshi_crypto_client import KalshiCryptoClient
from .market_state import compute_minutes_remaining
from .supabase_logger import SupabaseLogger

logger = logging.getLogger(__name__)

load_dotenv()


class KalshiCryptoStrategy(TradingStrategy):
    def get_name(self) -> str:
        return "kalshi-crypto"

    def get_type(self) -> str:
        return "scheduled"

    async def initialize(self):
        self.cfg = BtcScalpConfig.load()

        if not self.cfg.api_key_id or not self.cfg.private_key:
            env_hint = (
                "KALSHI_DEMO_KEY_ID / KALSHI_DEMO_PRIVATE_KEY"
                if self.cfg.use_demo
                else "KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY"
            )
            raise ValueError(f"{env_hint} must be set in .env")

        self._client = KalshiCryptoClient(
            self.cfg.api_key_id,
            self.cfg.private_key,
            use_demo=self.cfg.use_demo,
        )

        self._db: SupabaseLogger | None = None
        if self.cfg.supabase_url and self.cfg.supabase_key:
            self._db = SupabaseLogger(self.cfg.supabase_url, self.cfg.supabase_key)
        else:
            logger.warning("Supabase not configured — bet logging disabled")

        self._telegram = TelegramNotifier(self.cfg.telegram_token, self.cfg.telegram_chat_id)
        self._scheduler = AsyncIOScheduler()

        # Active trades: ticker → {side, entry_price, buy_order_id, sell_order_id}
        # Cleared on restart; Kalshi positions are the source of truth for fills.
        self._active_trades: dict[str, dict] = {}

        env_tag = "[DEMO]" if self.cfg.use_demo else "[LIVE]"
        logger.info(
            f"KalshiCrypto initialized {env_tag} | "
            f"series={self.cfg.series} | "
            f"entry {self.cfg.floor_cents}-{self.cfg.entry_cents}¢ → "
            f"sell@{self.cfg.target_cents}¢ stop@{self.cfg.stop_loss_cents}¢ | "
            f"contracts={self.cfg.contracts} | "
            f"scan={self.cfg.scan_interval_seconds}s"
        )

    async def start(self):
        self._scheduler.add_job(
            self._scan,
            IntervalTrigger(seconds=self.cfg.scan_interval_seconds),
            id="btc_scalp_scan",
            name="BTC scalp scan",
        )
        self._scheduler.start()
        self.is_running = True
        logger.info(
            f"KalshiCrypto started — scanning {self.cfg.series} "
            f"every {self.cfg.scan_interval_seconds}s"
        )

        try:
            while self.is_running:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            pass

    async def stop(self):
        self.is_running = False
        if hasattr(self, "_scheduler"):
            self._scheduler.shutdown(wait=False)
        if hasattr(self, "_client"):
            await self._client.close()

    def get_stats(self) -> dict:
        return {
            "strategy": self.get_name(),
            "series": self.cfg.series,
            "use_demo": self.cfg.use_demo,
            "active_trades": len(self._active_trades),
            "active_tickers": list(self._active_trades.keys()),
        }

    # ── Core scan ──────────────────────────────────────────────────────────────

    async def _scan(self):
        """
        Runs every 30s.
        1. Stop-loss check: for each active trade, if the bid for our side has
           dropped to ≤ stop_loss_cents, cancel the profit sell and exit.
        2. Entry scan: for each open market, check whether YES or NO ask is in
           the conviction zone (floor_cents – entry_cents).  Buy that side.
        """
        markets = await self._client.get_markets(self.cfg.series)
        if not markets:
            logger.debug(f"No open markets for {self.cfg.series}")
            return

        markets_by_ticker: dict[str, dict] = {
            m["ticker"]: m for m in markets if m.get("ticker")
        }

        # ── 1. Stop-loss monitoring ───────────────────────────────────────────
        for ticker, trade in list(self._active_trades.items()):
            market = markets_by_ticker.get(ticker)
            if market is None:
                # Market closed/resolved — remove and let Kalshi settle the position
                logger.info(f"[BTC SCALP] {ticker} no longer open, dropping from active trades")
                del self._active_trades[ticker]
                continue

            side = trade["side"]
            current_bid = market.get(f"{side}_bid", 0)

            if current_bid > 0 and current_bid <= self.cfg.stop_loss_cents:
                await self._stop_loss_exit(ticker, trade, current_bid)

        # ── 2. Entry scan ─────────────────────────────────────────────────────
        positions = await self._client.get_open_positions()
        positioned = {p.get("market_ticker") for p in positions}

        for ticker, market in markets_by_ticker.items():
            if ticker in self._active_trades or ticker in positioned:
                continue

            yes_ask = market.get("yes_ask", 100)
            yes_bid = market.get("yes_bid", 0)
            no_ask  = market.get("no_ask",  100)
            no_bid  = market.get("no_bid",  0)
            mins_left = compute_minutes_remaining(market)

            yes_in_zone = self.cfg.floor_cents <= yes_ask <= self.cfg.entry_cents
            no_in_zone  = self.cfg.floor_cents <= no_ask  <= self.cfg.entry_cents

            if yes_in_zone or no_in_zone:
                side_label = f"YES={yes_ask}¢ IN ZONE" if yes_in_zone else f"NO={no_ask}¢ IN ZONE"
                logger.info(
                    f"{ticker}  YES bid={yes_bid}¢ ask={yes_ask}¢  "
                    f"NO bid={no_bid}¢ ask={no_ask}¢  "
                    f"{mins_left:.1f}m left  ✓ {side_label}"
                )
            else:
                logger.info(
                    f"{ticker}  YES bid={yes_bid}¢ ask={yes_ask}¢  "
                    f"NO bid={no_bid}¢ ask={no_ask}¢  "
                    f"{mins_left:.1f}m left  "
                    f"skip (want {self.cfg.floor_cents}–{self.cfg.entry_cents}¢)"
                )
                continue

            # Prefer YES; fall back to NO if YES is not in zone
            if yes_in_zone:
                await self._enter(ticker, "yes", yes_ask, mins_left)
            else:
                await self._enter(ticker, "no", no_ask, mins_left)

    # ── Entry ──────────────────────────────────────────────────────────────────

    async def _enter(self, ticker: str, side: str, ask_price: int, mins_left: float):
        """Place limit buy + resting profit-take sell, then record the trade."""
        env_tag = " [DEMO]" if self.cfg.use_demo else ""
        logger.info(
            f"[BTC SCALP] {ticker}  {side.upper()} @ {ask_price}¢  "
            f"{mins_left:.1f}m left — entering"
        )

        await self._telegram.send(
            f"<b>[BTC] Scalp Signal{env_tag}</b>\n"
            f"Market: {ticker}  ({mins_left:.1f}m left)\n"
            f"Side: <b>{side.upper()}</b> @ {ask_price}¢  →  target <b>{self.cfg.target_cents}¢</b>  "
            f"stop <b>{self.cfg.stop_loss_cents}¢</b>\n"
            f"Contracts: {self.cfg.contracts}  |  cost ~${ask_price * self.cfg.contracts / 100:.2f}"
        )

        # Limit BUY
        buy = await self._client.place_order(
            ticker, side, self.cfg.contracts, ask_price, action="buy"
        )
        if not buy:
            logger.error(f"Buy order failed for {ticker} {side}")
            return
        buy_id = buy.get("order_id", "")

        # Resting limit SELL at profit target
        sell = await self._client.place_order(
            ticker, side, self.cfg.contracts, self.cfg.target_cents, action="sell"
        )
        sell_id = sell.get("order_id", "") if sell else "failed"

        logger.info(f"[BTC SCALP] Orders placed — buy={buy_id}  sell={sell_id}")

        await self._telegram.send(
            f"<b>[BTC] Orders Placed{env_tag}</b>\n"
            f"{side.upper()} x{self.cfg.contracts} @ {ask_price}¢  buy={buy_id}\n"
            f"{side.upper()} x{self.cfg.contracts} @ {self.cfg.target_cents}¢ sell={sell_id}"
        )

        # Record so we can apply stop-loss on next scans
        self._active_trades[ticker] = {
            "side": side,
            "entry_price": ask_price,
            "buy_order_id": buy_id,
            "sell_order_id": sell_id,
        }

        if self._db:
            from .models import CryptoBet
            bet = CryptoBet(
                asset_id="btc",
                strategy="scalp",
                market_ticker=ticker,
                side=side,
                contracts=self.cfg.contracts,
                price_per_contract=ask_price / 100.0,
                total_cost=round(ask_price * self.cfg.contracts / 100.0, 2),
                kalshi_order_id=buy_id,
                status="open",
            )
            await self._db.log_bet(bet)

    # ── Stop-loss exit ─────────────────────────────────────────────────────────

    async def _stop_loss_exit(self, ticker: str, trade: dict, current_bid: int):
        """
        Cancel the resting profit-take sell order and place a sell at the
        stop-loss price to exit the position.
        """
        side = trade["side"]
        entry_price = trade.get("entry_price", 0)
        sell_id = trade.get("sell_order_id", "")

        logger.warning(
            f"[BTC SCALP] {ticker} STOP LOSS  {side.upper()} bid={current_bid}¢ "
            f"≤ stop={self.cfg.stop_loss_cents}¢ — exiting"
        )

        # Cancel the profit-taking sell
        if sell_id and sell_id != "failed":
            cancelled = await self._client.cancel_order(sell_id)
            if not cancelled:
                logger.error(
                    f"Failed to cancel profit-sell {sell_id} for {ticker} "
                    f"— proceeding with stop sell anyway"
                )

        # Sell at whichever is lower: current bid or stop price
        # (ensures the order can fill against existing buyers)
        exit_price = min(current_bid, self.cfg.stop_loss_cents)
        stop_sell = await self._client.place_order(
            ticker, side, self.cfg.contracts, exit_price, action="sell"
        )
        stop_sell_id = stop_sell.get("order_id", "") if stop_sell else "failed"

        loss_cents = (entry_price - exit_price) * self.cfg.contracts
        logger.warning(
            f"[BTC SCALP] {ticker} stop-sell placed @ {exit_price}¢  id={stop_sell_id}  "
            f"loss ~${loss_cents / 100:.2f}"
        )

        env_tag = " [DEMO]" if self.cfg.use_demo else ""
        await self._telegram.send(
            f"<b>[BTC] Stop Loss Hit{env_tag}</b>\n"
            f"Market: {ticker}\n"
            f"Side: {side.upper()} | Entry: {entry_price}¢ → Stop: {exit_price}¢\n"
            f"Loss: ~${loss_cents / 100:.2f}  |  order={stop_sell_id}"
        )

        del self._active_trades[ticker]


StrategyRegistry.register("kalshi-crypto", KalshiCryptoStrategy)
