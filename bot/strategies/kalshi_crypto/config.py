from dataclasses import dataclass


@dataclass
class BtcScalpConfig:
    api_key_id: str = ''
    private_key: str = ''
    dry_run: bool = True
    series: str = 'KXBTC15M'
    entry_cents: int = 92
    target_cents: int = 97
    contracts: int = 5
    min_mins_left: float = 2.0
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
        return cls(
            api_key_id=kalshi.get('api-key-id', ''),
            private_key=kalshi.get('private-key', ''),
            dry_run=str(kalshi.get('dry-run', 'true')).lower() != 'false',
            series=c.get('series', 'KXBTC15M'),
            entry_cents=int(scalp.get('entry-cents', 92)),
            target_cents=int(scalp.get('target-cents', 97)),
            contracts=int(scalp.get('contracts', 5)),
            min_mins_left=float(scalp.get('min-mins-left', 2.0)),
            scan_interval_seconds=int(c.get('scan-interval-seconds', 30)),
            supabase_url=supabase.get('url', ''),
            supabase_key=supabase.get('service-key', ''),
            telegram_token=telegram.get('token', ''),
            telegram_chat_id=telegram.get('chat-id', ''),
        )
