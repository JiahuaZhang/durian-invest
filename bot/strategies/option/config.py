import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class OptionConfig:
    """
    Configuration for the systematic option premium selling strategy.

    This strategy checks every Monday morning whether conditions are favorable
    for selling an OTM put on the configured symbols. If conditions pass, a
    Telegram notification is sent so the user can manually place the trade.

    Key filters (from research):
      IV Rank 30–70:   premium is rich but not panic-driven
      IV-RV spread > 3%: implied volatility exceeds realized volatility — the
                         volatility risk premium is actually present
      Trend filter:    only sell puts when price is above 50-day moving average
                       (avoid selling puts into a sustained downtrend)
    """

    # Symbols to monitor
    symbols: List[str] = field(default_factory=lambda: ['SPY', 'QQQ'])

    # Check time (ET) — Monday signal check
    check_time: str = '10:00'

    # IV Rank bounds: 0-100 scale
    # Below 30 = premium is too thin (volatility risk premium is small)
    # Above 70 = possible panic spike — gamma risk can overwhelm theta
    ivr_min: float = 30.0
    ivr_max: float = 70.0

    # IV minus realized volatility minimum spread (in percentage points, annualized)
    # Only sell when implied volatility > realized volatility by this much
    # Research: 3–5 pp minimum; below this, the premium does not cover average costs
    iv_rv_min_spread: float = 3.0

    # Trend filter: skip put selling when price is below 50-day moving average
    # Selling puts in a downtrend = picking up nickels in front of a bulldozer
    trend_filter: bool = True

    # OTM distance for the recommended strike
    # 2% is safer than 1% for indexes (more room for the underlying to move)
    wing_pct: float = 0.02

    # Expiry: same-week Friday (4 DTE on Monday)
    # Research: weekly (WPUT) has lower max drawdown than monthly
    use_weekly_expiry: bool = True

    # Tuesday fallback: also check Tuesday if Monday conditions were not met
    tuesday_fallback: bool = True

    # Notifications
    telegram_token: str = ''
    telegram_chat_id: str = ''

    # Supabase logging (optional — strategy works without it)
    supabase_url: str = ''
    supabase_key: str = ''

    @classmethod
    def from_env(cls) -> 'OptionConfig':
        symbols_str = os.getenv('OPTION_SYMBOLS', 'SPY,QQQ')
        symbols = [s.strip() for s in symbols_str.split(',')]
        return cls(
            symbols=symbols,
            check_time=os.getenv('OPTION_CHECK_TIME', '10:00'),
            ivr_min=float(os.getenv('OPTION_IVR_MIN', '30')),
            ivr_max=float(os.getenv('OPTION_IVR_MAX', '70')),
            iv_rv_min_spread=float(os.getenv('OPTION_IV_RV_MIN_SPREAD', '3.0')),
            trend_filter=os.getenv('OPTION_TREND_FILTER', 'true').lower() == 'true',
            wing_pct=float(os.getenv('OPTION_WING_PCT', '0.02')),
            use_weekly_expiry=os.getenv('OPTION_USE_WEEKLY_EXPIRY', 'true').lower() == 'true',
            tuesday_fallback=os.getenv('OPTION_TUESDAY_FALLBACK', 'true').lower() == 'true',
            telegram_token=os.getenv('TELEGRAM_BOT_TOKEN', ''),
            telegram_chat_id=os.getenv('TELEGRAM_CHAT_ID', ''),
            supabase_url=os.getenv('SUPABASE_URL', ''),
            supabase_key=os.getenv('SUPABASE_SERVICE_KEY', ''),
        )
