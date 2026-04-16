"""
SharedState — account-level state shared across all ContractWindows.

Loaded once at startup, refreshed every 5 min by the scheduler, and updated
incrementally after each order so the in-memory view stays current without
polling Kalshi on every scan.
"""
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .kalshi_crypto_client import KalshiCryptoClient
    from .supabase_logger import SupabaseLogger

logger = logging.getLogger(__name__)


@dataclass
class SharedState:
    # Public fields — readable by any ContractWindow, mutated only via helpers below
    balance: float = 0.0
    open_positions: list = field(default_factory=list)   # list[dict] from Kalshi
    open_bets: list = field(default_factory=list)        # list[dict] from Supabase

    async def load(self, client: "KalshiCryptoClient", db: "SupabaseLogger") -> None:
        """Initial load at startup. Raises on failure — bot should not start without state."""
        self.balance = await client.get_balance()
        self.open_positions = await client.get_open_positions()
        self.open_bets = await db.get_open_bets()
        logger.info(
            f"SharedState loaded | balance=${self.balance:.2f} | "
            f"positions={len(self.open_positions)} | open_bets={len(self.open_bets)}"
        )

    async def refresh(self, client: "KalshiCryptoClient", db: "SupabaseLogger") -> None:
        """
        Periodic reconciliation (every 5 min). Re-fetches all three fields from
        their authoritative sources. Never raises — logs and continues.
        """
        try:
            self.balance = await client.get_balance()
            self.open_positions = await client.get_open_positions()
            self.open_bets = await db.get_open_bets()
            logger.debug(
                f"SharedState refreshed | balance=${self.balance:.2f} | "
                f"positions={len(self.open_positions)} | open_bets={len(self.open_bets)}"
            )
        except Exception as e:
            logger.error(f"SharedState refresh failed: {e}", exc_info=True)

    # ── Incremental mutations after order placement ────────────────────────────

    def add_position(self, ticker: str) -> None:
        if not any(p.get("market_ticker") == ticker for p in self.open_positions):
            self.open_positions.append({"market_ticker": ticker})

    def add_bet(self, bet_dict: dict) -> None:
        self.open_bets.append(bet_dict)

    def remove_bet(self, bet_id: str) -> None:
        self.open_bets = [b for b in self.open_bets if b.get("id") != bet_id]

    def cancel_bet_by_order(self, order_id: str) -> None:
        self.open_bets = [b for b in self.open_bets if b.get("kalshi_order_id") != order_id]

    def deduct_balance(self, amount: float) -> None:
        self.balance = max(self.balance - amount, 0.0)
