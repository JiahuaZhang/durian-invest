import uuid
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class OptionSignal:
    """
    Result of checking whether conditions are favorable to sell a put.

    Both passing and failing checks are recorded so the user can see
    why no notification was sent on a given Monday.
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    symbol: str = ''
    date: str = ''                # YYYY-MM-DD
    check_time: str = ''          # ISO timestamp of the check
    day_of_week: str = ''         # 'Monday' | 'Tuesday'

    # Current market conditions
    current_price: float = 0.0
    ma20: float = 0.0             # 20-day simple moving average
    ma50: float = 0.0             # 50-day simple moving average
    trend: str = ''               # 'uptrend' | 'downtrend' | 'unknown'

    # Volatility metrics
    implied_volatility: float = 0.0   # annualized (e.g. 0.18 = 18%)
    realized_volatility: float = 0.0  # 20-day historical volatility, annualized
    iv_rv_spread: float = 0.0         # implied_volatility - realized_volatility, in percentage points
    iv_rank: float = 0.0              # 0–100: where current IV sits in 52-week range

    # Filter results
    ivr_ok: bool = False          # IV Rank in acceptable range
    iv_rv_ok: bool = False        # IV-RV spread above minimum
    trend_ok: bool = False        # trend filter passed (or disabled)
    all_passed: bool = False      # True if all filters passed

    # Recommendation (only populated when all_passed=True)
    option_type: str = 'put'      # always 'put' for this strategy
    suggested_strike: Optional[float] = None   # wing_pct below current price
    expiry_date: Optional[str] = None          # YYYY-MM-DD (Friday)
    dte: Optional[int] = None
    estimated_premium_pct: Optional[float] = None  # Black-Scholes estimate as % of underlying

    # Human-readable explanation sent in the Telegram message
    rationale: str = ''
