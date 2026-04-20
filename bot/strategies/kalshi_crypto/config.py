from dataclasses import dataclass


@dataclass
class CryptoJobConfig:
    series: str
    entry_dollars: float
    target_dollars: float
    stop_loss_dollars: float
    count: int


@dataclass
class BtcScalpConfig:
    api_key_id: str = ''
    private_key: str = ''
    enabled: bool = False
    use_demo: bool = False
    series: str = 'KXBTC15M'
    entry_dollars: float = 0.92
    target_dollars: float = 0.97
    stop_loss_dollars: float = 0.88
    count: int = 1
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
        scalp = c.get('scalp', {})
        supabase = c.get('supabase', {})
        telegram = c.get('telegram', {})

        use_demo = str(kalshi.get('use-demo', 'false')).lower() == 'true'

        # config_loader already resolved ${ENV_VAR} substitutions from common.yml
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
            entry_dollars=float(scalp.get('entry-dollars', 0.92)),
            target_dollars=float(scalp.get('target-dollars', 0.97)),
            stop_loss_dollars=float(scalp.get('stop-loss-dollars', 0.88)),
            count=int(scalp.get('count', 1)),
            subaccount=int(scalp.get('subaccount', 0)),
            scan_interval_seconds=int(c.get('scan-interval-seconds', 30)),
            supabase_url=supabase.get('url', ''),
            supabase_key=supabase.get('service-key', ''),
            telegram_token=telegram.get('token', ''),
            telegram_chat_id=telegram.get('chat-id', ''),
        )
