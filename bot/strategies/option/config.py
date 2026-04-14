from dataclasses import dataclass, field
from typing import List


@dataclass
class OptionConfig:
    """
    Configuration for the systematic option premium selling strategy.
    Loaded from strategies/common.yml + strategies/option/config.yml.
    Edit config.yml to change parameters — no env vars needed for non-secrets.
    """

    symbols: List[str] = field(default_factory=lambda: ['SPY', 'QQQ'])
    check_time: str = '10:00'
    ivr_min: float = 30.0
    ivr_max: float = 70.0
    iv_rv_min_spread: float = 3.0
    trend_filter: bool = True
    wing_pct: float = 0.02
    use_weekly_expiry: bool = True
    tuesday_fallback: bool = True

    # Populated from common.yml (or overridden per config.yml)
    telegram_token: str = ''
    telegram_chat_id: str = ''
    supabase_url: str = ''
    supabase_key: str = ''

    @classmethod
    def load(cls) -> 'OptionConfig':
        """Load from strategies/common.yml + strategies/option/config.yml."""
        from strategies.config_loader import load_config
        c = load_config('option')

        symbols = c.get('symbols', ['SPY', 'QQQ'])
        if isinstance(symbols, str):
            symbols = [s.strip() for s in symbols.split(',')]

        return cls(
            symbols=symbols,
            check_time=c.get('check-time', '10:00'),
            ivr_min=float(c.get('ivr-min', 30.0)),
            ivr_max=float(c.get('ivr-max', 70.0)),
            iv_rv_min_spread=float(c.get('iv-rv-min-spread', 3.0)),
            trend_filter=bool(c.get('trend-filter', True)),
            wing_pct=float(c.get('wing-pct', 0.02)),
            use_weekly_expiry=bool(c.get('use-weekly-expiry', True)),
            tuesday_fallback=bool(c.get('tuesday-fallback', True)),
            telegram_token=c.get('telegram', {}).get('token', ''),
            telegram_chat_id=c.get('telegram', {}).get('chat-id', ''),
            supabase_url=c.get('supabase', {}).get('url', ''),
            supabase_key=c.get('supabase', {}).get('service-key', ''),
        )
