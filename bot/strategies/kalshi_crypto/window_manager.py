"""
WindowManager — per-asset manager for ContractWindow instances.

On startup and every 15 minutes, fetches open markets from Kalshi and groups
them by their 15-min time slot (all markets sharing a close_time belong to
the same window). Creates a ContractWindow for each new slot discovered.

tick() is called at :25 and :55 each minute by KalshiCryptoStrategy,
which drives the phase transitions and strategy evaluation inside each window.
"""
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .config import AssetConfig
from .models import CryptoResolution
from .notifier import format_resolution
from .window import ContractWindow, WindowPhase

if TYPE_CHECKING:
    from .candle_cache import CandleCache
    from .kalshi_crypto_client import KalshiCryptoClient
    from .shared_state import SharedState
    from .supabase_logger import SupabaseLogger
    from ..telegram_notifier import TelegramNotifier

logger = logging.getLogger(__name__)


class WindowManager:
    """
    Manages all ContractWindows for a single asset.

    Windows are keyed by close_time (UTC, tz-aware). Safe to call
    reload_windows() repeatedly — existing windows are never replaced
    since they hold live bet/phase state.
    """

    def __init__(
        self,
        asset_cfg: AssetConfig,
        client: "KalshiCryptoClient",
        db: "SupabaseLogger",
        telegram: "TelegramNotifier",
        candle_cache: "CandleCache",
        shared_state: "SharedState",
        scheduler: AsyncIOScheduler,
    ):
        self._cfg = asset_cfg
        self._client = client
        self._db = db
        self._telegram = telegram
        self._cache = candle_cache
        self._state = shared_state
        self._scheduler = scheduler

        # close_time → ContractWindow
        self._windows: dict[datetime, ContractWindow] = {}

        # Per-asset daily stats (reset on process restart)
        self._daily_pnl: float = 0.0
        self._daily_wins: int = 0
        self._daily_losses: int = 0

    # ── Public interface (called by KalshiCryptoStrategy) ─────────────────────

    async def reload_windows(self) -> None:
        """
        Fetch open markets, group by 15-min slot, create ContractWindows for
        any new slots. Called once at startup and every 15 min thereafter.
        """
        markets = await self._client.get_markets(self._cfg.series)
        if not markets:
            logger.warning(
                f"[{self._cfg.id.upper()}] No open markets for {self._cfg.series}"
            )
            return

        grouped = _group_markets_by_window(markets)
        now = datetime.now(timezone.utc)
        new_count = 0

        # Prune fully-resolved windows before adding new ones
        self._evict_done()

        for close_time, (open_time, window_markets) in grouped.items():
            if close_time in self._windows:
                continue  # window already tracked — do NOT overwrite
            if close_time < now:
                continue  # window already expired before we even started

            cw = ContractWindow(
                asset_id=self._cfg.id,
                asset_cfg=self._cfg,
                close_time=close_time,
                markets=window_markets,
                shared_state=self._state,
                candle_cache=self._cache,
                client=self._client,
                db=self._db,
                telegram=self._telegram,
                scheduler=self._scheduler,
                on_resolved=self._on_resolved,
            )
            self._windows[close_time] = cw
            new_count += 1

            status = (
                "active now"
                if open_time <= now
                else f"opens at {open_time.strftime('%H:%M:%S UTC')}"
            )
            logger.info(
                f"[{self._cfg.id.upper()}] Window {cw.window_key} registered — "
                f"{len(window_markets)} market(s), {status}, "
                f"closes {close_time.strftime('%H:%M UTC')}"
            )

        if new_count:
            logger.info(
                f"[{self._cfg.id.upper()}] {new_count} new window(s) registered "
                f"({len(self._windows)} total)"
            )

    async def tick(self) -> None:
        """
        Called at :25 and :55 each minute. Drives all non-DONE windows.
        Errors within a single window are contained and logged.
        """
        for window in list(self._windows.values()):
            if window.phase == WindowPhase.DONE:
                continue
            try:
                await window.tick()
            except Exception as e:
                logger.error(
                    f"[{self._cfg.id.upper()}] Tick error in {window.window_key}: {e}",
                    exc_info=True,
                )
        self._evict_done()

    def get_stats(self) -> dict:
        phase_counts: dict[str, int] = defaultdict(int)
        for w in self._windows.values():
            phase_counts[w.phase.name] += 1
        return {
            "asset": self._cfg.id,
            "windows": dict(phase_counts),
            "daily_pnl": round(self._daily_pnl, 2),
            "daily_wins": self._daily_wins,
            "daily_losses": self._daily_losses,
        }

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _on_resolved(self, resolution: CryptoResolution) -> None:
        """Callback passed into every ContractWindow. Updates daily stats + Telegram."""
        self._daily_pnl += resolution.profit_loss
        if resolution.won:
            self._daily_wins += 1
        else:
            self._daily_losses += 1
        await self._telegram.send(
            format_resolution(
                resolution,
                daily_pnl=self._daily_pnl,
                daily_wins=self._daily_wins,
                daily_losses=self._daily_losses,
            )
        )

    def _evict_done(self) -> None:
        done = [ct for ct, w in self._windows.items() if w.phase == WindowPhase.DONE]
        for ct in done:
            del self._windows[ct]


def _group_markets_by_window(
    markets: list[dict],
) -> dict[datetime, tuple[datetime, list[dict]]]:
    """
    Group market dicts by their 15-min window.
    All markets with the same close_time belong to the same window.
    Returns: close_time → (open_time, [market, ...])
    """
    by_close: dict[str, list] = defaultdict(list)
    for m in markets:
        raw = m.get("close_time", "")
        if raw:
            by_close[raw].append(m)

    result: dict[datetime, tuple[datetime, list[dict]]] = {}
    for close_raw, window_markets in by_close.items():
        try:
            close_time = datetime.fromisoformat(close_raw.replace("Z", "+00:00"))
            open_time = close_time - timedelta(minutes=15)
            result[close_time] = (open_time, window_markets)
        except Exception:
            logger.warning(f"Unparseable close_time: {close_raw!r} — skipping")
    return result
