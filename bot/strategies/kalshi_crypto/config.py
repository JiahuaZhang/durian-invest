from dataclasses import dataclass


@dataclass
class CryptoJobConfig:
    series: str
    count: int
    spread: float = 0.05
    imbalance: float = 0.50


@dataclass
class BtcScalpConfig:
    api_key_id: str = ''
    private_key: str = ''
    enabled: bool = False
    use_demo: bool = False
    series: str = 'KXBTC15M'
    count: int = 1
    spread: float = 0.05
    imbalance: float = 0.50
    subaccount: int = 0
    scan_interval_seconds: int = 30
    supabase_url: str = ''
    supabase_key: str = ''
    telegram_token: str = ''
    telegram_chat_id: str = ''

    @classmethod
    def load(cls) -> 'BtcScalpConfig':
        from strategies.config_loader import load_config
        c = load_config('kalshi_crypto')
        kalshi = c.get('kalshi', {})
        strategy = c.get('strategy', {})
        supabase = c.get('supabase', {})
        telegram = c.get('telegram', {})

        use_demo = str(kalshi.get('use-demo', 'false')).lower() == 'true'

        if use_demo:
            api_key_id  = kalshi.get('demo-api-key-id', '')
            private_key = kalshi.get('demo-private-key', '')
        else:
            api_key_id  = kalshi.get('api-key-id', '')
            private_key = kalshi.get('private-key', '')

        return cls(
            api_key_id=api_key_id,
            private_key=private_key,
            enabled=str(c.get('enabled', 'false')).lower() == 'true',
            use_demo=use_demo,
            series=c.get('series', 'KXBTC15M'),
            count=int(strategy.get('count', 1)),
            spread=float(strategy.get('spread', 0.05)),
            imbalance=float(strategy.get('imbalance', 0.50)),
            subaccount=int(strategy.get('subaccount', 0)),
            scan_interval_seconds=int(c.get('scan-interval-seconds', 30)),
            supabase_url=supabase.get('url', ''),
            supabase_key=supabase.get('service-key', ''),
            telegram_token=telegram.get('token', ''),
            telegram_chat_id=telegram.get('chat-id', ''),
        )
