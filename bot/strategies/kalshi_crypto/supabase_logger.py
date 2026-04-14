import asyncio
import logging
from typing import Any, Dict, Optional

from supabase import create_client, Client

from .models import CryptoBet, CryptoResolution, CryptoSignal

logger = logging.getLogger(__name__)


class SupabaseLogger:
    def __init__(self, url: str, key: str):
        self.client: Client = create_client(url, key)

    def _run_sync(self, fn):
        return asyncio.get_event_loop().run_in_executor(None, fn)

    async def log_signal(self, s: CryptoSignal) -> Optional[str]:
        try:
            data = {
                "id": s.id,
                "asset_id": s.asset_id,
                "strategy": s.strategy,
                "action": s.action,
                "market_ticker": s.market_ticker,
                "entry_price": s.entry_price,
                "target_price": s.target_price,
                "stop_price": s.stop_price,
                "edge": s.edge,
                "spot_price": s.spot_price,
                "vol_15m": s.vol_15m,
                "minutes_remaining": s.minutes_remaining,
                "detected_at": s.detected_at or None,
            }
            await self._run_sync(
                lambda: self.client.table("crypto_signals").insert(data).execute()
            )
            return s.id
        except Exception as e:
            logger.error(f"Failed to log signal {s.market_ticker}: {e}")
            return None

    async def log_bet(self, b: CryptoBet) -> Optional[str]:
        try:
            data = {
                "id": b.id,
                "signal_id": b.signal_id,
                "asset_id": b.asset_id,
                "strategy": b.strategy,
                "market_ticker": b.market_ticker,
                "side": b.side,
                "contracts": b.contracts,
                "price_per_contract": b.price_per_contract,
                "total_cost": b.total_cost,
                "kalshi_order_id": b.kalshi_order_id,
                "status": b.status,
                "placed_at": b.placed_at or None,
            }
            await self._run_sync(
                lambda: self.client.table("crypto_bets").insert(data).execute()
            )
            logger.info(
                f"Bet: [{b.asset_id.upper()}] {b.strategy} {b.side.upper()} "
                f"x{b.contracts} {b.market_ticker} @ {b.price_per_contract:.2f} "
                f"(${b.total_cost:.2f})"
            )
            return b.id
        except Exception as e:
            logger.error(f"Failed to log bet {b.market_ticker}: {e}")
            return None

    async def update_bet_status(
        self, bet_id: str, status: str, pnl: Optional[float] = None
    ):
        try:
            updates: Dict[str, Any] = {"status": status}
            if pnl is not None:
                updates["pnl"] = pnl
            await self._run_sync(
                lambda: self.client.table("crypto_bets")
                .update(updates)
                .eq("id", bet_id)
                .execute()
            )
        except Exception as e:
            logger.error(f"Failed to update bet {bet_id}: {e}")

    async def log_resolution(self, r: CryptoResolution) -> Optional[str]:
        try:
            data = {
                "id": r.id,
                "bet_id": r.bet_id,
                "market_ticker": r.market_ticker,
                "asset_id": r.asset_id,
                "strategy": r.strategy,
                "outcome": r.outcome,
                "won": r.won,
                "payout": r.payout,
                "profit_loss": r.profit_loss,
                "resolved_at": r.resolved_at or None,
            }
            await self._run_sync(
                lambda: self.client.table("crypto_resolutions").insert(data).execute()
            )
            status = "WIN" if r.won else "LOSS"
            logger.info(
                f"Resolution [{status}]: [{r.asset_id.upper()}] {r.strategy} "
                f"{r.market_ticker} P&L=${r.profit_loss:+.2f}"
            )
            return r.id
        except Exception as e:
            logger.error(f"Failed to log resolution {r.market_ticker}: {e}")
            return None

    async def get_open_bets(self) -> list[dict]:
        """Return all bets with status='open' for reversal cap checks and resolution matching."""
        try:
            result = await self._run_sync(
                lambda: self.client.table("crypto_bets")
                .select("*")
                .eq("status", "open")
                .execute()
            )
            return result.data or []
        except Exception as e:
            logger.error(f"Failed to fetch open bets: {e}")
            return []
