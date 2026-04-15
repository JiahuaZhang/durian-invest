from dataclasses import dataclass, field


@dataclass
class ScalpConfig:
    entry_price: float = 0.92           # buy YES when ask ≤ this
    target_price: float = 0.97          # limit sell YES at this price
    stop_price: float = 0.88            # exit if YES drops here
    min_minutes_remaining: float = 2.0  # don't enter with < 2 min left
    max_bet_usd: float = 10.0
    kelly_fraction: float = 0.25


@dataclass
class ReversalConfig:
    entry_price: float = 0.02     # buy YES when ask ≤ 2¢
    vol_threshold: float = 0.0015 # skip if 15-min realised vol exceeds this
    max_concurrent: int = 5       # max open reversal positions per asset
    size_usd: float = 10.0        # fixed size per trade (not Kelly)


@dataclass
class MarketMakerConfig:
    entry_price: float = 0.49          # limit buy both YES and NO at this price
    window_seconds: float = 60.0       # only active for first N seconds of candle
    cancel_after_seconds: float = 30.0 # cancel unfilled side after this delay
    max_combined_cost: float = 0.98    # skip if combined cost > 98¢
    size_usd: float = 50.0             # USD per side (YES + NO = 2x this)
    max_bankroll_pct: float = 0.15     # never exceed 15% of bankroll across MM positions


@dataclass
class AssetConfig:
    id: str = ''
    series: str = ''
    scalp: ScalpConfig = field(default_factory=ScalpConfig)
    reversal: ReversalConfig = field(default_factory=ReversalConfig)
    mm: MarketMakerConfig = field(default_factory=MarketMakerConfig)


@dataclass
class KalshiCryptoConfig:
    api_key_id: str = ''
    private_key: str = ''
    dry_run: bool = True
    assets: list[AssetConfig] = field(default_factory=list)
    scan_interval_seconds: int = 30
    supabase_url: str = ''
    supabase_key: str = ''
    telegram_token: str = ''
    telegram_chat_id: str = ''

    @classmethod
    def load(cls) -> 'KalshiCryptoConfig':
        from strategies.config_loader import load_config
        c = load_config('kalshi_crypto')

        kalshi = c.get('kalshi', {})

        assets = []
        for a in c.get('assets', []):
            if not a.get('enabled', True):
                continue

            s = a.get('scalp', {})
            r = a.get('reversal', {})
            m = a.get('market-maker', {})

            assets.append(AssetConfig(
                id=a.get('id', ''),
                series=a.get('series', ''),
                scalp=ScalpConfig(
                    entry_price=float(s.get('entry-price', 0.92)),
                    target_price=float(s.get('target-price', 0.97)),
                    stop_price=float(s.get('stop-price', 0.88)),
                    min_minutes_remaining=float(s.get('min-minutes-remaining', 2.0)),
                    max_bet_usd=float(s.get('max-bet-usd', 10.0)),
                    kelly_fraction=float(s.get('kelly-fraction', 0.25)),
                ),
                reversal=ReversalConfig(
                    entry_price=float(r.get('entry-price', 0.02)),
                    vol_threshold=float(r.get('vol-threshold', 0.0015)),
                    max_concurrent=int(r.get('max-concurrent', 5)),
                    size_usd=float(r.get('size-usd', 10.0)),
                ),
                mm=MarketMakerConfig(
                    entry_price=float(m.get('entry-price', 0.49)),
                    window_seconds=float(m.get('window-seconds', 60.0)),
                    cancel_after_seconds=float(m.get('cancel-after-seconds', 30.0)),
                    max_combined_cost=float(m.get('max-combined-cost', 0.98)),
                    size_usd=float(m.get('size-usd', 50.0)),
                    max_bankroll_pct=float(m.get('max-bankroll-pct', 0.15)),
                ),
            ))

        supabase = c.get('supabase', {})
        telegram = c.get('telegram', {})

        return cls(
            api_key_id=kalshi.get('api-key-id', ''),
            private_key=kalshi.get('private-key', ''),
            dry_run=str(kalshi.get('dry-run', 'true')).lower() != 'false',
            assets=assets,
            scan_interval_seconds=int(c.get('scan-interval-seconds', 30)),
            supabase_url=supabase.get('url', ''),
            supabase_key=supabase.get('service-key', ''),
            telegram_token=telegram.get('token', ''),
            telegram_chat_id=telegram.get('chat-id', ''),
        )
