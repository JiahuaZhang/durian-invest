-- ORB (Open Range Breakout) Trading Bot Schema
-- Run this in Supabase SQL Editor

-- Opening range data collected each morning per symbol
create table orb_opening_ranges (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  date date not null,
  range_start timestamptz,
  range_end timestamptz,
  high numeric not null,
  low numeric not null,
  open numeric not null,
  close numeric not null,
  volume bigint,
  vwap numeric,
  range_size numeric not null,
  range_pct numeric,
  direction text not null, -- 'bullish' or 'bearish'
  bars_json jsonb, -- raw 1-min bar data for charting
  created_at timestamptz default now(),
  unique (symbol, date)
);

create index idx_orb_ranges_date on orb_opening_ranges(date);

-- Every detected breakout signal (logged even when filters reject it)
create table orb_signals (
  id uuid primary key default gen_random_uuid(),
  range_id uuid references orb_opening_ranges(id),
  symbol text not null,
  date date not null,
  signal_time timestamptz,
  direction text not null, -- 'long' or 'short'
  breakout_price numeric not null,
  range_high numeric not null,
  range_low numeric not null,
  range_size numeric not null,
  body_close_confirmed boolean,
  volume_confirmed boolean,
  vwap_confirmed boolean,
  all_filters_passed boolean not null,
  vwap_at_signal numeric,
  volume_at_signal bigint,
  avg_volume_20d bigint,
  variant text,
  day_of_week text,
  created_at timestamptz default now()
);

create index idx_orb_signals_date on orb_signals(symbol, date);

-- Executed trades (only signals that passed filters and were acted on)
create table orb_trades (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references orb_signals(id),
  symbol text not null,
  date date not null,
  variant text,
  entry_time timestamptz,
  entry_price numeric not null,
  entry_side text not null, -- 'buy' or 'sell'
  qty numeric not null,
  exit_time timestamptz,
  exit_price numeric,
  exit_reason text, -- 'stop_loss', 'take_profit', 'eod_close'
  pnl numeric,
  pnl_pct numeric,
  stop_loss_price numeric not null,
  take_profit_price numeric not null,
  entry_order_id text,
  exit_order_id text,
  status text not null default 'open', -- 'open', 'closed', 'cancelled'
  created_at timestamptz default now()
);

create index idx_orb_trades_date on orb_trades(date);
create index idx_orb_trades_symbol_date on orb_trades(symbol, date);

-- Daily aggregated summary
create table orb_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  date date unique not null,
  symbols text[],
  variant text,
  total_signals int default 0,
  signals_passed int default 0,
  trades_taken int default 0,
  trades_won int default 0,
  trades_lost int default 0,
  total_pnl numeric default 0,
  win_rate numeric,
  avg_range_size numeric,
  notes text,
  created_at timestamptz default now()
);
