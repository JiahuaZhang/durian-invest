import uuid
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class WeatherSignal:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    detected_at: str = ''                  # ISO timestamptz
    market_ticker: str = ''               # Kalshi market ID
    city: str = ''
    icao: str = ''                         # Aviation station code
    metric: str = ''                       # 'high_temp' | 'low_temp' | 'precip'
    threshold: float = 0.0                 # e.g. 54.0 (°F)
    target_date: str = ''                  # YYYY-MM-DD
    metar_temp_f: Optional[float] = None   # Current METAR reading
    nws_forecast_value: Optional[float] = None  # NWS predicted value
    our_probability: float = 0.0           # Our P(yes)
    market_yes_price: float = 0.0          # Kalshi market price 0–1
    edge: float = 0.0                      # our_probability - market_yes_price
    action: str = 'SKIP'                   # 'BUY_YES' | 'BUY_NO' | 'SKIP'


@dataclass
class WeatherBet:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    signal_id: str = ''
    placed_at: str = ''                    # ISO timestamptz
    market_ticker: str = ''
    side: str = ''                         # 'yes' | 'no'
    contracts: int = 0
    price_per_contract: float = 0.0        # Execution price (0–1)
    total_cost: float = 0.0               # USD spent
    kalshi_order_id: str = ''
    status: str = 'open'                   # 'open' | 'filled' | 'cancelled'


@dataclass
class WeatherResolution:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    bet_id: str = ''
    resolved_at: str = ''                  # ISO timestamptz
    market_ticker: str = ''
    outcome: str = ''                      # 'yes' | 'no'
    won: bool = False
    payout: float = 0.0                    # USD received
    profit_loss: float = 0.0              # payout - total_cost
    actual_weather_value: Optional[float] = None
