import asyncio
import logging
from datetime import datetime, timezone

from ..telegram_notifier import TelegramNotifier
from .config import CryptoJobConfig
from .kalshi_crypto_client import KalshiCryptoClient
from .market_state import current_market_ticker
from .supabase_logger import SupabaseLogger

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
        self._active_trades: dict[str, dict] = {}

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

        logger.info(
            f"[{self.cfg.series}] Window {ticker} — polling every {POLL_INTERVAL}s "
            f"for {secs_left:.0f}s"
        )

        # Fetch positions once for this window; updated locally when we enter a trade.
        positions = await self._client.get_open_positions()
        already_positioned = ticker in {p.get("market_ticker") for p in positions}

        while True:
            now = datetime.now(timezone.utc)
            secs_left = (close_time - now).total_seconds()

            if secs_left < POLL_INTERVAL:
                logger.info(f"[{self.cfg.series}] {ticker} window closing — exiting poll loop")
                break

            entered, market_closed = await self._tick(ticker, secs_left, already_positioned)
            if entered:
                already_positioned = True
            if market_closed:
                logger.info(f"[{self.cfg.series}] {ticker} market closed — exiting poll loop")
                break

            await asyncio.sleep(POLL_INTERVAL)

    async def _tick(self, ticker: str, secs_left: float, already_positioned: bool) -> tuple[bool, bool]:
        """
        One poll cycle.
        Returns (entered, market_closed):
          entered       — True if we just placed a trade this tick
          market_closed — True if the loop should stop (market resolved/gone)
        """
        # ── Stop-loss monitoring ──────────────────────────────────────────────
        if ticker in self._active_trades:
            trade = self._active_trades[ticker]
            market = await self._client.get_market(ticker)
            if market is None:
                logger.info(f"[{self.cfg.series}] {ticker} not found — treating as closed")
                del self._active_trades[ticker]
                return False, True

            if market.get("status") == "closed":
                logger.info(f"[{self.cfg.series}] {ticker} resolved")
                del self._active_trades[ticker]
                return False, True

            side = trade["side"]
            current_bid = market.get(f"{side}_bid", 0)
            if current_bid > 0 and current_bid <= self.cfg.stop_loss_cents:
                await self._stop_loss_exit(ticker, trade, current_bid)
            return False, False

        # ── Entry scan ────────────────────────────────────────────────────────
        if already_positioned:
            return False, False

        market = await self._client.get_market(ticker)
        if not market:
            logger.debug(f"Market {ticker} not yet available")
            return False, False

        if market.get("status") == "closed":
            return False, True

        yes_ask = market.get("yes_ask", 100)
        yes_bid = market.get("yes_bid", 0)
        no_ask  = market.get("no_ask",  100)
        no_bid  = market.get("no_bid",  0)

        yes_in_zone = self.cfg.floor_cents <= yes_ask <= self.cfg.entry_cents
        no_in_zone  = self.cfg.floor_cents <= no_ask  <= self.cfg.entry_cents

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
            return True, False
        else:
            logger.debug(
                f"{ticker}  YES ask={yes_ask}¢  NO ask={no_ask}¢  "
                f"{secs_left:.0f}s left  "
                f"(want {self.cfg.floor_cents}–{self.cfg.entry_cents}¢)"
            )
            return False, False

    async def _enter(self, ticker: str, side: str, ask_price: int, secs_left: float):
        env_tag = " [DEMO]" if self._use_demo else ""
        logger.info(
            f"[{self.cfg.series}] {ticker}  {side.upper()} @ {ask_price}¢  "
            f"{secs_left:.0f}s left — entering"
        )

        await self._telegram.send(
            f"<b>[{self.cfg.series}] Scalp Signal{env_tag}</b>\n"
            f"Market: {ticker}  ({secs_left:.0f}s left)\n"
            f"Side: <b>{side.upper()}</b> @ {ask_price}¢  →  target <b>{self.cfg.target_cents}¢</b>  "
            f"stop <b>{self.cfg.stop_loss_cents}¢</b>\n"
            f"Contracts: {self.cfg.contracts}  |  cost ~${ask_price * self.cfg.contracts / 100:.2f}"
        )

        buy = await self._client.place_order(
            ticker, side, self.cfg.contracts, ask_price, action="buy"
        )
        if not buy:
            logger.error(f"Buy order failed for {ticker} {side}")
            return
        buy_id = buy.get("order_id", "")

        sell = await self._client.place_order(
            ticker, side, self.cfg.contracts, self.cfg.target_cents, action="sell"
        )
        sell_id = sell.get("order_id", "") if sell else "failed"

        logger.info(f"[{self.cfg.series}] Orders placed — buy={buy_id}  sell={sell_id}")

        await self._telegram.send(
            f"<b>[{self.cfg.series}] Orders Placed{env_tag}</b>\n"
            f"{side.upper()} x{self.cfg.contracts} @ {ask_price}¢  buy={buy_id}\n"
            f"{side.upper()} x{self.cfg.contracts} @ {self.cfg.target_cents}¢ sell={sell_id}"
        )

        self._active_trades[ticker] = {
            "side": side,
            "entry_price": ask_price,
            "buy_order_id": buy_id,
            "sell_order_id": sell_id,
        }

        if self._db:
            from .models import CryptoBet
            bet = CryptoBet(
                asset_id=self.cfg.series.lower(),
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

    async def _stop_loss_exit(self, ticker: str, trade: dict, current_bid: int):
        side = trade["side"]
        entry_price = trade.get("entry_price", 0)
        sell_id = trade.get("sell_order_id", "")

        logger.warning(
            f"[{self.cfg.series}] {ticker} STOP LOSS  {side.upper()} bid={current_bid}¢ "
            f"≤ stop={self.cfg.stop_loss_cents}¢ — exiting"
        )

        if sell_id and sell_id != "failed":
            cancelled = await self._client.cancel_order(sell_id)
            if not cancelled:
                logger.error(
                    f"Failed to cancel profit-sell {sell_id} for {ticker} "
                    f"— proceeding with stop sell anyway"
                )

        exit_price = min(current_bid, self.cfg.stop_loss_cents)
        stop_sell = await self._client.place_order(
            ticker, side, self.cfg.contracts, exit_price, action="sell"
        )
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

        del self._active_trades[ticker]
