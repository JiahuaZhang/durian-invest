import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class ORBConfig:
    symbols: List[str] = field(default_factory=lambda: ['SPY', 'QQQ'])
    range_start: str = '09:30'
    range_end: str = '09:45'
    entry_end: str = '15:30'
    eod_close_time: str = '15:45'
    variant: str = 'simple'  # simple, body_close, volume, vwap, combined
    volume_threshold: float = 1.5
    position_size_pct: float = 0.05
    max_positions: int = 2
    use_range_stop: bool = True
    take_profit_mult: float = 2.0
    poll_interval_sec: int = 30
    supabase_url: str = ''
    supabase_key: str = ''

    @classmethod
    def from_env(cls) -> 'ORBConfig':
        symbols_str = os.getenv('ORB_SYMBOLS', 'SPY,QQQ')
        symbols = [s.strip() for s in symbols_str.split(',')]

        return cls(
            symbols=symbols,
            range_start=os.getenv('ORB_RANGE_START', '09:30'),
            range_end=os.getenv('ORB_RANGE_END', '09:45'),
            entry_end=os.getenv('ORB_ENTRY_END', '15:30'),
            eod_close_time=os.getenv('ORB_EOD_CLOSE', '15:45'),
            variant=os.getenv('ORB_VARIANT', 'simple'),
            volume_threshold=float(os.getenv('ORB_VOLUME_THRESHOLD', '1.5')),
            position_size_pct=float(os.getenv('ORB_POSITION_SIZE_PCT', '0.05')),
            max_positions=int(os.getenv('ORB_MAX_POSITIONS', '2')),
            use_range_stop=os.getenv('ORB_USE_RANGE_STOP', 'true').lower() == 'true',
            take_profit_mult=float(os.getenv('ORB_TAKE_PROFIT_ATR', '2.0')),
            poll_interval_sec=int(os.getenv('ORB_POLL_INTERVAL', '30')),
            supabase_url=os.getenv('SUPABASE_URL', ''),
            supabase_key=os.getenv('SUPABASE_SERVICE_KEY', ''),
        )
