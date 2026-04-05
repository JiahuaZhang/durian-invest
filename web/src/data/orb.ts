import { createServerFn } from '@tanstack/react-start'
import { getSupabaseClient } from '../utils/supabase/client'

export type ORBTradeRow = {
    id: string
    signal_id: string
    symbol: string
    date: string
    variant: string
    entry_time: string
    entry_price: number
    entry_side: string
    qty: number
    exit_time: string | null
    exit_price: number | null
    exit_reason: string | null
    pnl: number | null
    pnl_pct: number | null
    stop_loss_price: number
    take_profit_price: number
    status: string
    // joined signal fields
    signal_direction: string | null
    signal_time: string | null
    breakout_price: number | null
    body_close_confirmed: boolean | null
    volume_confirmed: boolean | null
    vwap_confirmed: boolean | null
    all_filters_passed: boolean | null
    range_high: number | null
    range_low: number | null
    range_size: number | null
}

export type ORBDailySummary = {
    id: string
    date: string
    symbols: string[]
    variant: string
    total_signals: number
    signals_passed: number
    trades_taken: number
    trades_won: number
    trades_lost: number
    total_pnl: number
    win_rate: number
    avg_range_size: number
}

export type ORBOpeningRange = {
    id: string
    symbol: string
    date: string
    high: number
    low: number
    open: number
    close: number
    volume: number
    vwap: number
    range_size: number
    range_pct: number
    direction: string
    bars_json: Array<{
        time: string
        open: number
        high: number
        low: number
        close: number
        volume: number
    }>
}

export const fetchORBTrades = createServerFn({ method: 'GET' })
    .inputValidator((d: { startDate?: string; endDate?: string; symbol?: string }) => d)
    .handler(async ({ data }) => {
        const sb = getSupabaseClient()
        let query = sb
            .from('orb_trades')
            .select(`
                *,
                orb_signals!inner (
                    direction,
                    signal_time,
                    breakout_price,
                    body_close_confirmed,
                    volume_confirmed,
                    vwap_confirmed,
                    all_filters_passed,
                    range_high,
                    range_low,
                    range_size
                )
            `)
            .order('date', { ascending: false })
            .order('entry_time', { ascending: false })

        if (data.startDate) query = query.gte('date', data.startDate)
        if (data.endDate) query = query.lte('date', data.endDate)
        if (data.symbol) query = query.eq('symbol', data.symbol)

        const { data: rows, error } = await query
        if (error) throw new Error(error.message)

        return (rows ?? []).map((r: any) => ({
            ...r,
            signal_direction: r.orb_signals?.direction ?? null,
            signal_time: r.orb_signals?.signal_time ?? null,
            breakout_price: r.orb_signals?.breakout_price ?? null,
            body_close_confirmed: r.orb_signals?.body_close_confirmed ?? null,
            volume_confirmed: r.orb_signals?.volume_confirmed ?? null,
            vwap_confirmed: r.orb_signals?.vwap_confirmed ?? null,
            all_filters_passed: r.orb_signals?.all_filters_passed ?? null,
            range_high: r.orb_signals?.range_high ?? null,
            range_low: r.orb_signals?.range_low ?? null,
            range_size: r.orb_signals?.range_size ?? null,
            orb_signals: undefined,
        })) as ORBTradeRow[]
    })

export const fetchORBSummaries = createServerFn({ method: 'GET' })
    .inputValidator((d: { startDate?: string; endDate?: string }) => d)
    .handler(async ({ data }) => {
        const sb = getSupabaseClient()
        let query = sb
            .from('orb_daily_summaries')
            .select('*')
            .order('date', { ascending: true })

        if (data.startDate) query = query.gte('date', data.startDate)
        if (data.endDate) query = query.lte('date', data.endDate)

        const { data: rows, error } = await query
        if (error) throw new Error(error.message)
        return (rows ?? []) as ORBDailySummary[]
    })

export const fetchORBOpeningRange = createServerFn({ method: 'GET' })
    .inputValidator((d: { date: string; symbol: string }) => d)
    .handler(async ({ data }) => {
        const sb = getSupabaseClient()
        const { data: row, error } = await sb
            .from('orb_opening_ranges')
            .select('*')
            .eq('date', data.date)
            .eq('symbol', data.symbol)
            .single()

        if (error) throw new Error(error.message)
        return row as ORBOpeningRange
    })
