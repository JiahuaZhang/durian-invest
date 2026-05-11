import asyncio
import logging
from typing import Any, cast

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from ..config import BotConfig
from ..feeds.binance import BinanceFeed
from ..feeds.chainlink import ChainlinkFeed
from ..feeds.coinbase import CoinbaseFeed
from ..feeds.polymarket_crypto_price import PolymarketCryptoPrice
from ..feeds.polymarket_market_channel import PolymarketMarketChannel
from ..feeds.polymarket_state import PolymarketState
from ..market_state import get_market_slug
from ..markets import get_market_by_slug
from ..signals.divergence import PriceSource, TradeSignal

logger = logging.getLogger(__name__)

# Bridge window offsets from each window's start (in minutes).
# For interval=5: bridge runs minute 2→4 of each window
# (e.g. window 5-10 → bridge 7-9).
_BRIDGE_START_OFFSET_MIN = 2
_BRIDGE_DURATION_MIN = 2


class FeedManager:
    """
    Manager for Polymarket up/down markets.

    Two cron-aligned jobs drive the lifecycle:

    1. Window activation (every interval boundary, e.g. minute 0/5/10/...):
       fetch the new market, create its PolymarketState, subscribe to its
       orderbook websocket.

    2. Bridge window (offset minutes into each window, e.g. minute 2/7/12/...):
       start forwarding Binance/Coinbase/Chainlink price ticks into the
       current state for divergence evaluation.  Controlled by a simple
       `should_check` flag — set True at bridge start, set False at bridge
       end or when a signal is detected.
    """

    def __init__(self, cfg: BotConfig):
        self.cfg = cfg
        self.poly_ws = PolymarketMarketChannel(on_message=self._on_market_msg)
        self.binance = BinanceFeed(
            symbol=cfg.feeds.binance_symbol,
            proxy=cfg.httpx_proxy,
            on_update=self._on_price_update,
        )
        self.coinbase = CoinbaseFeed(
            product=cfg.feeds.coinbase_product,
            on_update=self._on_price_update,
        )
        self.chainlink = ChainlinkFeed(
            feed_id=cfg.feeds.chainlink_feed_id,
            poll_seconds=cfg.feeds.chainlink_poll_seconds,
            on_update=self._on_price_update,
        )

        self.states: dict[str, PolymarketState] = {}
        self.current_state: PolymarketState | None = None
        self.scheduler = AsyncIOScheduler()

        # When True, incoming price ticks are forwarded to current_state.
        self.should_check = False

        self._feed_tasks: list[asyncio.Task] = []

    async def run(self) -> None:
        """Run until cancelled."""
        logger.info(
            "Starting FeedManager | crypto=%s interval=%dm",
            self.cfg.crypto,
            self.cfg.interval_minutes,
        )
        self._feed_tasks = [
            asyncio.create_task(self.poly_ws.connect(), name="polymarket-market-feed"),
            asyncio.create_task(self.binance.connect(), name="binance-feed"),
            asyncio.create_task(self.coinbase.connect(), name="coinbase-feed"),
            asyncio.create_task(self.chainlink.connect(), name="chainlink-feed"),
        ]

        await self._activate_current_window()

        self.scheduler.add_job(
            self._activate_current_window,
            CronTrigger(minute=f"*/{self.cfg.interval_minutes}"),
            id="window-activation",
            coalesce=True,
            misfire_grace_time=30,
        )
        bridge_end_offset = _BRIDGE_START_OFFSET_MIN + _BRIDGE_DURATION_MIN
        self.scheduler.add_job(
            self._start_bridge_window,
            CronTrigger(minute=f"{_BRIDGE_START_OFFSET_MIN}-59/{self.cfg.interval_minutes}"),
            id="bridge-start",
            coalesce=True,
            misfire_grace_time=15,
        )
        self.scheduler.add_job(
            self._stop_bridge_window,
            CronTrigger(minute=f"{bridge_end_offset}-59/{self.cfg.interval_minutes}"),
            id="bridge-stop",
            coalesce=True,
            misfire_grace_time=15,
        )
        self.scheduler.start()
        logger.info(
            "Scheduler started | activate=*/%d bridge=%d-59/%d stop=%d-59/%d",
            self.cfg.interval_minutes,
            _BRIDGE_START_OFFSET_MIN,
            self.cfg.interval_minutes,
            bridge_end_offset,
            self.cfg.interval_minutes,
        )

        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            pass
        finally:
            self.stop()

    # ── Market window activation ───────────────────────────────────

    async def _activate_current_window(self) -> None:
        """Fetch the current window's market and add its orderbook to states."""
        slug = get_market_slug(self.cfg.crypto, self.cfg.interval_minutes)
        logger.info("Activating market: slug=%s", slug)

        market = await get_market_by_slug(slug)
        if market is None:
            logger.warning("Market not found yet: %s; will retry next tick", slug)
            return

        state = PolymarketState(
            cfg=self.cfg,
            market=market,
            asset=market.up_token_id,
            on_signal=self._on_signal_emitted,
        )
        self.states[market.up_token_id] = state
        self.current_state = state

        self.poly_ws.subscribe([market.up_token_id])
        logger.info(
            "Subscribed: slug=%s up_token=%s... active_states=%d",
            slug,
            market.up_token_id[:16],
            len(self.states),
        )

        asyncio.create_task(self._poll_open_price(state, slug), name=f"open-price-{slug}")

    async def _poll_open_price(self, state: PolymarketState, slug: str) -> None:
        """Poll for the open price every 2s, up to 30s total."""
        for attempt in range(15):
            await asyncio.sleep(2)
            price = await PolymarketCryptoPrice.get_open_price(slug)
            if price is not None:
                state.open_price = price
                logger.info("Open price set for %s: $%.2f (attempt %d)", slug, price, attempt + 1)
                return

        logger.warning("Open price still unavailable after 30s for %s", slug)

    # ── Bridge window (price feeds → state) ────────────────────────

    async def _start_bridge_window(self) -> None:
        """Cron-triggered: enable price forwarding to current state."""
        self.current_state.seed_prices(
            binance=self.binance.price,
            coinbase=self.coinbase.price,
            chainlink=self.chainlink.price,
        )
        self.should_check = True
        logger.info(
            "Bridge started | slug=%s binance=$%.2f coinbase=$%.2f chainlink=$%.2f",
            self.current_state.slug,
            self.binance.price,
            self.coinbase.price,
            self.chainlink.price,
        )

    async def _stop_bridge_window(self) -> None:
        """Cron-triggered: disable price forwarding."""
        if self.should_check:
            self.should_check = False
            slug = self.current_state.slug if self.current_state else "?"
            logger.info("Bridge stopped | slug=%s", slug)

    def _on_price_update(self, source: str, price: float) -> None:
        """Feed callback. Only forwards to current_state when should_check is True."""
        if not self.should_check:
            return

        self.current_state.update_price(cast(PriceSource, source), price)

    def _on_signal_emitted(self, state: PolymarketState, signal: TradeSignal) -> None:
        """Called synchronously by PolymarketState when a signal is detected."""
        self.should_check = False
        logger.info(
            "Signal received | slug=%s side=%s entry=$%.2f bid=$%.2f source=%s",
            state.slug,
            signal.side_label,
            signal.entry_price,
            signal.bid_price,
            signal.source,
        )
        # TODO (next phase): trigger order placement here.

    # ── Polymarket market websocket ────────────────────────────────

    def _on_market_msg(self, msg: dict[str, Any]) -> None:
        for state in self.states.values():
            state.apply_market_message(msg)

        if msg.get("event_type") == "market_resolved":
            self._on_market_resolved(msg)

    def _on_market_resolved(self, msg: dict[str, Any]) -> None:
        assets_ids = set(msg.get("assets_ids") or msg.get("asset_ids") or [])
        resolved = [aid for aid in self.states if aid in assets_ids]
        if not resolved:
            raise ValueError(f"No resolved states found for assets: {assets_ids}")

        self.poly_ws.unsubscribe(resolved)
        for aid in resolved:
            self.states.pop(aid, None)
            logger.info("Unsubscribed from asset %s, market resolved", aid)

    # ── Shutdown ───────────────────────────────────────────────────

    def stop(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

        self.should_check = False

        for state in list(self.states.values()):
            self.poly_ws.unsubscribe([state.asset])

        self.states.clear()
        self.current_state = None

        self.poly_ws.stop()
        self.binance.stop()
        self.coinbase.stop()
        self.chainlink.stop()

        for task in self._feed_tasks:
            task.cancel()
        self._feed_tasks.clear()
