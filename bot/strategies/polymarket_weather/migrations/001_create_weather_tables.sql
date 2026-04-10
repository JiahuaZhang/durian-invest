-- Weather Arbitrage Bot — Supabase schema
-- Run this in your Supabase SQL editor at:
--   supabase.com → Project → SQL Editor → New Query

-- ─────────────────────────────────────────────
-- Table 1: weather_signals
-- Every opportunity detected (whether we bet or not)
-- ─────────────────────────────────────────────
create table if not exists weather_signals (
    id                  uuid primary key default gen_random_uuid(),
    detected_at         timestamptz not null default now(),
    market_ticker       text not null,
    city                text not null,
    icao                text not null,           -- Aviation station (e.g. KORD)
    metric              text not null,           -- 'high_temp' | 'low_temp' | 'precip'
    threshold           float not null,          -- e.g. 54.0 (°F)
    target_date         date not null,
    metar_temp_f        float,                   -- Current METAR reading at scan time
    nws_forecast_value  float,                   -- NWS forecast for target_date
    our_probability     float not null,          -- Our P(yes)
    market_yes_price    float not null,          -- Kalshi market price 0–1
    edge                float not null,          -- our_probability - market_yes_price
    action              text not null            -- 'BUY_YES' | 'BUY_NO' | 'SKIP'
);

create index if not exists idx_weather_signals_ticker on weather_signals(market_ticker);
create index if not exists idx_weather_signals_detected_at on weather_signals(detected_at desc);
create index if not exists idx_weather_signals_action on weather_signals(action) where action != 'SKIP';

-- ─────────────────────────────────────────────
-- Table 2: weather_bets
-- Each bet actually placed on Kalshi
-- ─────────────────────────────────────────────
create table if not exists weather_bets (
    id                  uuid primary key default gen_random_uuid(),
    signal_id           uuid references weather_signals(id),
    placed_at           timestamptz not null default now(),
    market_ticker       text not null,
    side                text not null,           -- 'yes' | 'no'
    contracts           int not null,
    price_per_contract  float not null,          -- Execution price 0–1
    total_cost          float not null,          -- USD spent
    kalshi_order_id     text,
    status              text not null default 'open'  -- 'open' | 'filled' | 'cancelled'
);

create index if not exists idx_weather_bets_signal on weather_bets(signal_id);
create index if not exists idx_weather_bets_ticker on weather_bets(market_ticker);
create index if not exists idx_weather_bets_status on weather_bets(status);

-- ─────────────────────────────────────────────
-- Table 3: weather_resolutions
-- Final outcome of each bet (win or loss)
-- ─────────────────────────────────────────────
create table if not exists weather_resolutions (
    id                    uuid primary key default gen_random_uuid(),
    bet_id                uuid references weather_bets(id),
    resolved_at           timestamptz not null default now(),
    market_ticker         text not null,
    outcome               text not null,         -- 'yes' | 'no' (what the market resolved to)
    won                   boolean not null,
    payout                float not null,        -- USD received from Kalshi
    profit_loss           float not null,        -- payout - total_cost
    actual_weather_value  float                  -- What the weather actually measured
);

create index if not exists idx_weather_resolutions_bet on weather_resolutions(bet_id);

-- ─────────────────────────────────────────────
-- Useful views for monitoring P&L
-- ─────────────────────────────────────────────

-- Daily P&L summary
create or replace view weather_daily_pnl as
select
    date_trunc('day', b.placed_at) as trade_date,
    count(*)                         as bets,
    sum(b.total_cost)                as total_staked,
    sum(r.payout)                    as total_payout,
    sum(r.profit_loss)               as net_pnl,
    sum(case when r.won then 1 else 0 end)::float / count(*) as win_rate
from weather_bets b
join weather_resolutions r on r.bet_id = b.id
group by 1
order by 1 desc;

-- Edge vs actual outcome (calibration check)
create or replace view weather_calibration as
select
    round(s.our_probability::numeric, 1) as predicted_p,
    count(*)                              as n,
    avg(case when r.won then 1.0 else 0.0 end) as actual_win_rate,
    avg(s.edge)                           as avg_edge
from weather_signals s
join weather_bets b on b.signal_id = s.id
join weather_resolutions r on r.bet_id = b.id
group by 1
order by 1;
