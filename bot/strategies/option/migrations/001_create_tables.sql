-- Option Strategy — Supabase Schema
-- Run in Supabase SQL Editor

-- Signal log: one row per check, whether it passed or not
create table if not exists option_signals (
  id                  uuid primary key default gen_random_uuid(),
  symbol              text not null,
  date                date not null,
  check_time          timestamptz,
  day_of_week         text,               -- 'Monday' | 'Tuesday'

  -- Market conditions at check time
  current_price       numeric,
  ma20                numeric,
  ma50                numeric,
  trend               text,               -- 'uptrend' | 'downtrend' | 'unknown'

  -- Volatility metrics
  implied_volatility  numeric,            -- annualized % (e.g. 18.5)
  realized_volatility numeric,            -- 20-day historical volatility, annualized %
  iv_rv_spread        numeric,            -- implied_volatility - realized_volatility (pp)
  iv_rank             numeric,            -- 0–100

  -- Filter results
  ivr_ok              boolean,
  iv_rv_ok            boolean,
  trend_ok            boolean,
  all_passed          boolean,

  -- Recommendation (populated when all_passed = true)
  suggested_strike    numeric,
  expiry_date         date,
  dte                 int,
  estimated_premium_pct numeric,

  rationale           text,
  created_at          timestamptz default now()
);

create index if not exists idx_option_signals_symbol_date
  on option_signals(symbol, date);
create index if not exists idx_option_signals_date
  on option_signals(date);
create index if not exists idx_option_signals_passed
  on option_signals(all_passed);

-- Weekly filter pass rate — useful for reviewing signal quality over time
create or replace view option_signal_stats as
select
  symbol,
  count(*)                                               as total_checks,
  sum(case when all_passed then 1 else 0 end)            as signals_fired,
  round(
    sum(case when all_passed then 1 else 0 end)::numeric
    / nullif(count(*), 0) * 100, 1
  )                                                      as signal_rate_pct,
  round(avg(iv_rank)::numeric, 1)                        as avg_iv_rank,
  round(avg(iv_rv_spread)::numeric, 2)                   as avg_iv_rv_spread,
  round(avg(case when all_passed then estimated_premium_pct end)::numeric, 3)
                                                         as avg_est_premium_pct
from option_signals
group by symbol
order by signals_fired desc;
