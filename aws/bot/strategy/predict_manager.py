"""
Predict.fun BTC 5-min up/down market manager.

State-machine driven trading bot for predict.fun crypto 5-minute
up/down markets.  The bot cycles through states:

    READY → BUYING → HOLDING → SELLING → READY

With a special WATCHING mode for observation-only operation.

States
──────
READY    — check signals on every price tick; enter BUYING on signal.
BUYING   — async order in flight; ticks update prices but skip signals.
HOLDING  — position open; check for stop-loss / take-profit.
SELLING  — async exit order in flight; ticks update prices only.
WATCHING — observation mode; logs signals, never acts, never transitions.
STOPPED  — non-recoverable error (e.g. insufficient funds); bot halted.

Macro cycle (every 5-minute boundary):
    Cancel in-flight orders, reset state to READY (unless WATCHING/STOPPED),
    fetch the new market, subscribe its orderbook, and poll the open price.
    Positions in old markets resolve via market settlement events.

Price feeds (Binance, Coinbase, Chainlink) flow continuously into
PredictState — the hot path is never blocked by order execution.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, cast

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from ..config import BotConfig
from ..feeds.binance import BinanceFeed
from ..feeds.chainlink import ChainlinkFeed
from ..feeds.coinbase import CoinbaseFeed
from ..predict.client import PredictClient
from ..predict.market_channel import PredictMarketChannel
from ..predict.state import PredictState, PredictPriceSource, PredictStatus

logger = logging.getLogger(__name__)

# Default path where each LatencyAnalysis snapshot is appended as JSONL.
_DEFAULT_LOG_PATH = Path(__file__).resolve().parent.parent / "logs" / "predict_latency.jsonl"

NEED_ANALYSIS_LOG = True


class PredictManager:
    """State-machine driven manager for predict.fun 5-min crypto markets."""

    def __init__(
        self,
        cfg: BotConfig,
        *,
        log_path: Path | str = _DEFAULT_LOG_PATH,
        watching: bool = False,
    ):
        self.cfg = cfg
        self.watching = watching
        self.client = PredictClient(cfg)
        self.predict_ws = PredictMarketChannel(
            predict=cfg.predict,
            on_message=self._on_market_msg,
        )
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

        # ── Market tracking ──
        self.states: dict[int, PredictState] = {}
        self.current_state: PredictState | None = None
        self._previous_market_id: int | None = None

        self.scheduler = AsyncIOScheduler()
        self._feed_tasks: list[asyncio.Task] = []

        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        
        self.stop_event = asyncio.Event()

    # ── Lifecycle ──────────────────────────────────────────────────

    async def run(self) -> None:
        """Run until cancelled."""
        logger.info(
            "Starting PredictManager | crypto=%s interval=%dm watching=%s log=%s",
            self.cfg.crypto,
            self.cfg.interval_minutes,
            self.watching,
            self.log_path,
        )
        self._feed_tasks = [
            asyncio.create_task(self.predict_ws.connect(), name="predict-market-feed"),
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
        self.scheduler.add_job(
            self._cleanup_previous_window,
            CronTrigger(minute=f"*/{self.cfg.interval_minutes}", second=20),
            id="window-cleanup",
            coalesce=True,
            misfire_grace_time=30,
        )
        self.scheduler.start()
        logger.info("Scheduler started | window=*/%d", self.cfg.interval_minutes)

        try:
            await self.stop_event.wait()
        except asyncio.CancelledError:
            pass
        finally:
            self.stop()

    # ── Window management ─────────────────────────────────────────

    async def _activate_current_window(self) -> None:
        """Fetch the current 5-min market, set up new PredictState, and subscribe."""
        raw_market = await self.client.get_current_5m_crypto_market(
            crypto=self.cfg.crypto,
        )
        if raw_market is None:
            logger.warning(
                "Market not found yet for crypto=%s; will retry next window",
                self.cfg.crypto,
            )
            return

        try:
            state = PredictState(
                cfg=self.cfg,
                client=self.client,
                market=raw_market,
                stop_event=self.stop_event,
            )
            market_id = state.market_id
        except (TypeError, ValueError, KeyError):
            logger.warning(
                "Failed to parse predict.fun market payload: %s",
                raw_market.get("id"),
            )
            return

        if self._previous_market_id is not None:
            self.predict_ws.unsubscribe(
                [f"predictOrderbook/{self._previous_market_id}"],
            )

        self.states[market_id] = state
        self.current_state = state
        self._previous_market_id = market_id

        state.update('binance', self.binance.price)
        state.update('coinbase', self.coinbase.price)
        state.update('chainlink', self.chainlink.price)

        topic = f"predictOrderbook/{market_id}"
        self.predict_ws.subscribe([topic])
        logger.info(
            "Window activated | id=%s slug=%s status=%s active_states=%d",
            market_id,
            state.slug,
            state.status.value,
            len(self.states),
        )

        asyncio.create_task(
            self._poll_open_price(state),
            name=f"open-price-{state.slug}",
        )

    async def _poll_open_price(self, state: PredictState) -> None:
        """Poll for the open (start) price every 2s, up to 30s total."""
        if state.start_price and state.start_price > 0:
            logger.info(
                "Open price preset from market payload: slug=%s $%.2f",
                state.slug,
                state.start_price,
            )
            return

        for attempt in range(15):
            await asyncio.sleep(2)
            price = await PredictClient.get_start_price(crypto=self.cfg.crypto)
            if price is not None and price > 0:
                state.start_price = price
                logger.info(
                    "Open price set for %s: $%.2f (attempt %d)",
                    state.slug,
                    price,
                    attempt + 1,
                )
                return

        logger.warning("Open price still unavailable after 30s for %s", state.slug)

    async def _cleanup_previous_window(self) -> None:
        """Poll the previous market to ensure it is resolved and cleaned up.
        
        Predict.fun markets typically resolve 5-15 seconds after the window ends.
        """
        market_id = self._previous_market_id
        if market_id is None or market_id not in self.states:
            return

        state = self.states[market_id]
        if state.status == PredictStatus.STOPPED:
            # Already resolved/cleaned via WebSocket or previous poll
            return

        logger.info("Checking resolution status for previous market %s...", market_id)
        market_data = await self.client.get_market(market_id)
        if not market_data:
            return

        data = market_data.get("data", {})
        if data.get("status") == "RESOLVED":
            self._on_market_resolved(data)
        else:
            logger.warning("Previous market %s is still %s; will retry next cycle", market_id, data.get("status"))

    # ── Price feed handling (hot path) ────────────────────────────

    def _on_price_update(self, source: str, price: float) -> None:
        """Feed callback — always updates state, then lets state process the tick."""
        self.current_state.update(source, price)

    # ── Market WS handling ────────────────────────────────────────

    def _on_market_msg(self, msg: dict[str, Any]) -> None:
        """Route predict.fun WS messages to the appropriate handler."""
        topic = str(msg.get("topic") or "")

        if topic.startswith("predictOrderbook/"):
            try:
                market_id = int(topic.split("/", 1)[1])
            except (IndexError, ValueError):
                return
            state = self.states.get(market_id)
            if state is not None:
                state.update("orderbook", msg)
            return

        if topic.startswith("marketResolution/") or topic.startswith("marketSettled/"):
            data = msg.get("data") or {}
            self._on_market_resolved(data)

    def _on_market_resolved(self, market_data: dict[str, Any]) -> None:
        """Handle market resolution: compute P&L if we held a position and clean up state."""
        market_id = market_data.get("id") or market_data.get("marketId")
        if market_id is None:
            return

        try:
            market_id = int(market_id)
        except (TypeError, ValueError):
            return

        state = self.states.get(market_id)
        if state is None:
            return

        state.resolve(market_data)

        del self.states[market_id]
        logger.info("Removed resolved state for market %s", market_id)

    # ── Public API ────────────────────────────────────────────────

    def set_watching(self) -> None:
        """Switch to observation-only mode. State never leaves WATCHING."""
        self.watching = True
        for state in self.states.values():
            state.stop_orders()
            state.status = PredictStatus.WATCHING
        logger.info("Switched all active states to WATCHING mode")

    def stop(self) -> None:
        """Graceful shutdown."""
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

        for market_id, state in list(self.states.items()):
            state.stop_orders()
            state.status = PredictStatus.STOPPED
            self.predict_ws.unsubscribe([f"predictOrderbook/{market_id}"])

        self.states.clear()
        self.current_state = None

        self.predict_ws.stop()
        self.binance.stop()
        self.coinbase.stop()
        self.chainlink.stop()

        for task in self._feed_tasks:
            task.cancel()
        self._feed_tasks.clear()

        logger.info("PredictManager stopped")
