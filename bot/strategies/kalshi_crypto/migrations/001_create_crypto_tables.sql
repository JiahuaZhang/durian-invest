-- Kalshi Crypto 15-min Prediction Bot
-- Run this in your Supabase SQL editor before starting the strategy.

create table if not exists crypto_signals (
    id                uuid        primary key default gen_random_uuid(),
    asset_id          text        not null,           -- 'btc' | 'eth' | 'sol' etc.
    strategy          text        not null,           -- 'scalp' | 'reversal' | 'market_maker'
    action            text        not null,           -- 'BUY_YES' | 'BUY_BOTH' | 'SKIP'
    market_ticker     text        not null,
    entry_price       float       not null,           -- YES ask price at signal (0–1)
    target_price      float,
    stop_price        float,
    edge              float       not null,
    spot_price        float,                          -- underlying asset price from Kraken
    vol_15m           float,                          -- realised vol at signal time
    minutes_remaining float,
    detected_at       timestamptz not null default now()
);

create table if not exists crypto_bets (
    id                  uuid        primary key default gen_random_uuid(),
    signal_id           uuid        references crypto_signals(id),
    asset_id            text        not null,
    strategy            text        not null,
    market_ticker       text        not null,
    side                text        not null,         -- 'yes' | 'no'
    contracts           int         not null,
    price_per_contract  float       not null,
    total_cost          float       not null,
    kalshi_order_id     text,
    status              text        not null default 'open',
    placed_at           timestamptz not null default now(),
    pnl                 float
);

create table if not exists crypto_resolutions (
    id              uuid        primary key default gen_random_uuid(),
    bet_id          uuid        references crypto_bets(id),
    market_ticker   text        not null,
    asset_id        text        not null,
    strategy        text        not null,
    outcome         text        not null,             -- 'yes' | 'no'
    won             boolean     not null,
    payout          float       not null,
    profit_loss     float       not null,
    resolved_at     timestamptz not null default now()
);

-- Calibration view: predicted entry bucket vs actual win rate per strategy per asset
create or replace view crypto_calibration as
select
    s.asset_id,
    s.strategy,
    round(s.entry_price::numeric, 2)            as entry_bucket,
    count(*)                                    as n,
    avg(case when r.won then 1.0 else 0.0 end)  as actual_win_rate,
    sum(r.profit_loss)                          as total_pnl,
    avg(r.profit_loss)                          as avg_pnl_per_trade
from crypto_signals s
join crypto_bets b      on b.signal_id = s.id
join crypto_resolutions r on r.bet_id  = b.id
where s.action != 'SKIP'
group by 1, 2, 3
order by 1, 2, 3;

-- Daily P&L summary view
create or replace view crypto_daily_pnl as
select
    date_trunc('day', r.resolved_at) as day,
    r.asset_id,
    r.strategy,
    count(*)                         as total_bets,
    sum(case when r.won then 1 else 0 end) as wins,
    sum(case when r.won then 0 else 1 end) as losses,
    sum(r.profit_loss)               as total_pnl,
    avg(r.profit_loss)               as avg_pnl
from crypto_resolutions r
group by 1, 2, 3
order by 1 desc, 2, 3;
