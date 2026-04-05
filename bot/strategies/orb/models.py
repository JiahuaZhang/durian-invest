import uuid
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class OpeningRange:
    symbol: str
    date: str  # YYYY-MM-DD
    high: float
    low: float
    open: float
    close: float
    volume: int
    vwap: float
    bars: List[Dict[str, Any]]  # raw 1-min bar data

    @property
    def range_size(self) -> float:
        return self.high - self.low

    @property
    def range_pct(self) -> float:
        return (self.range_size / self.open) * 100 if self.open else 0

    @property
    def direction(self) -> str:
        return 'bullish' if self.close >= self.open else 'bearish'


@dataclass
class ORBSignal:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    range_id: Optional[str] = None
    symbol: str = ''
    date: str = ''
    signal_time: str = ''  # ISO format
    direction: str = ''  # 'long' or 'short'
    breakout_price: float = 0
    range_high: float = 0
    range_low: float = 0
    range_size: float = 0
    body_close_confirmed: Optional[bool] = None
    volume_confirmed: Optional[bool] = None
    vwap_confirmed: Optional[bool] = None
    all_filters_passed: bool = False
    vwap_at_signal: Optional[float] = None
    volume_at_signal: Optional[int] = None
    avg_volume_20d: Optional[int] = None
    variant: str = ''
    day_of_week: str = ''


@dataclass
class ORBTrade:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    signal_id: str = ''
    symbol: str = ''
    date: str = ''
    variant: str = ''
    entry_time: str = ''
    entry_price: float = 0
    entry_side: str = ''  # 'buy' or 'sell'
    qty: float = 0
    exit_time: Optional[str] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[str] = None  # 'stop_loss', 'take_profit', 'eod_close'
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    stop_loss_price: float = 0
    take_profit_price: float = 0
    entry_order_id: str = ''
    exit_order_id: Optional[str] = None
    status: str = 'open'  # 'open', 'closed', 'cancelled'
