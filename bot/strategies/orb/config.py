from dataclasses import dataclass, field
from typing import List


@dataclass
class ORBConfig:
    symbols: List[str] = field(default_factory=lambda: ['SPY', 'QQQ'])
    range_start: str = '09:30'
    range_end: str = '09:45'
    entry_end: str = '15:30'
    eod_close_time: str = '15:45'
    variant: str = 'simple'          # simple | body_close | volume | vwap | combined
    volume_threshold: float = 1.5
    position_size_pct: float = 0.05
    max_positions: int = 2
    use_range_stop: bool = True
    take_profit_mult: float = 2.0
    poll_interval_sec: int = 30
    supabase_url: str = ''
    supabase_key: str = ''

    @classmethod
    def load(cls) -> 'ORBConfig':
        """Load from strategies/common.yml + strategies/orb/config.yml."""
        from strategies.config_loader import load_config
        c = load_config('orb')

        symbols = c.get('symbols', ['SPY', 'QQQ'])
        if isinstance(symbols, str):
            symbols = [s.strip() for s in symbols.split(',')]

        return cls(
            symbols=symbols,
            range_start=c.get('range-start', '09:30'),
            range_end=c.get('range-end', '09:45'),
            entry_end=c.get('entry-end', '15:30'),
            eod_close_time=c.get('eod-close-time', '15:45'),
            variant=c.get('variant', 'simple'),
            volume_threshold=float(c.get('volume-threshold', 1.5)),
            position_size_pct=float(c.get('position-size-pct', 0.05)),
            max_positions=int(c.get('max-positions', 2)),
            use_range_stop=bool(c.get('use-range-stop', True)),
            take_profit_mult=float(c.get('take-profit-mult', 2.0)),
            poll_interval_sec=int(c.get('poll-interval-sec', 30)),
            supabase_url=c.get('supabase', {}).get('url', ''),
            supabase_key=c.get('supabase', {}).get('service-key', ''),
        )
