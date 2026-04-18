from dataclasses import dataclass


@dataclass
class CryptoJobConfig:
    series: str
    floor_cents: int
    entry_cents: int
    target_cents: int
    stop_loss_cents: int
    contracts: int


@dataclass
class BtcScalpConfig:
    api_key_id: str = ''
    private_key: str = ''
    use_demo: bool = False
    series: str = 'KXBTC15M'
    floor_cents: int = 85
    entry_cents: int = 92
    target_cents: int = 97
    stop_loss_cents: int = 88
    contracts: int = 1
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
            use_demo=use_demo,
            series=c.get('series', 'KXBTC15M'),
            floor_cents=int(scalp.get('floor-cents', 85)),
            entry_cents=int(scalp.get('entry-cents', 92)),
            target_cents=int(scalp.get('target-cents', 97)),
            stop_loss_cents=int(scalp.get('stop-loss-cents', 88)),
            contracts=int(scalp.get('contracts', 1)),
            scan_interval_seconds=int(c.get('scan-interval-seconds', 30)),
            supabase_url=supabase.get('url', ''),
            supabase_key=supabase.get('service-key', ''),
            telegram_token=telegram.get('token', ''),
            telegram_chat_id=telegram.get('chat-id', ''),
        )
