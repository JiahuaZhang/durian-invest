import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class PriceWindow:
    closes: list[float]
    volumes: list[float]
    fetched_at: str = field(default_factory=_now_iso)

    @property
    def current_price(self) -> float:
        return self.closes[-1] if self.closes else 0.0

    @property
    def volatility_15m(self) -> float:
        """Std dev of 1-min log returns over the last 15 candles."""
        if len(self.closes) < 16:
            return 0.0
        returns = [
            (self.closes[i] - self.closes[i - 1]) / self.closes[i - 1]
            for i in range(-15, 0)
            if self.closes[i - 1] != 0
        ]
        if not returns:
            return 0.0
        mean = sum(returns) / len(returns)
        variance = sum((r - mean) ** 2 for r in returns) / len(returns)
        return variance ** 0.5


@dataclass
class CryptoSignal:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    asset_id: str = ''           # 'btc' | 'eth' | 'sol' etc.
    strategy: str = ''           # 'scalp' | 'reversal' | 'market_maker'
    action: str = 'SKIP'         # 'BUY_YES' | 'BUY_BOTH' | 'SKIP'
    market_ticker: str = ''
    entry_dollars: float = 0.0     # YES ask price at signal time (0–1 scale)
    target_dollars: Optional[float] = None
    stop_loss_dollars: Optional[float] = None
    edge: float = 0.0
    spot_price: float = 0.0      # Underlying asset price from Kraken
    vol_15m: float = 0.0         # Realized vol at signal time
    minutes_remaining: float = 0.0
    detected_at: str = field(default_factory=_now_iso)
    skip_reason: str = ''


@dataclass
class CryptoBet:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    signal_id: str = ''
    asset_id: str = ''
    strategy: str = ''
    market_ticker: str = ''
    side: str = ''               # 'yes' | 'no'
    count: int = 0
    price_per_contract: float = 0.0
    total_cost: float = 0.0
    kalshi_order_id: str = ''
    status: str = 'open'         # 'open' | 'filled' | 'cancelled' | 'resolved'
    placed_at: str = field(default_factory=_now_iso)
    pnl: Optional[float] = None


@dataclass
class CryptoResolution:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    bet_id: str = ''
    market_ticker: str = ''
    asset_id: str = ''
    strategy: str = ''
    outcome: str = ''            # 'yes' | 'no'
    won: bool = False
    payout: float = 0.0
    profit_loss: float = 0.0
    resolved_at: str = field(default_factory=_now_iso)
