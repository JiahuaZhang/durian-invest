-- Kalshi Crypto 15-min Stats Table
-- Run this in your Supabase SQL editor to create the stats collection table.

CREATE TABLE IF NOT EXISTS public.crypto_15m_stats (
    ticker TEXT PRIMARY KEY,
    l1_detected_time TEXT,
    l1_net_profit NUMERIC,
    l2_detected_time TEXT,
    l2_net_profit NUMERIC,
    l3_detected_time TEXT,
    l3_net_profit NUMERIC,
    l4_detected_time TEXT,
    l4_net_profit NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
