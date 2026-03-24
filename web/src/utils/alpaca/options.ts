/**
 * Alpaca Options — server functions and processed UI types.
 *
 * Raw API types live in ./types.ts.
 * OCC symbol parsing lives in ./occ.ts.
 * HTTP client lives in ./client.ts.
 *
 * This module exposes two TanStack server functions:
 *   fetchOptionChain — fetch all snapshots for an underlying symbol
 *   fetchOptionBars  — fetch OHLCV history for a specific contract
 *
 * And two processed (UI-ready) types:
 *   OptionSnapshot   — flattened, null-safe version of AlpacaOptionSnapshot
 *   OptionBar        — re-export of AlpacaBar (fields are already ideal for charting)
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { ALPACA_DATA_BASE, alpacaFetch } from './client'
import { parseOCC } from './occ'
import type { AlpacaBar, AlpacaBarsResponse, AlpacaSnapshotsResponse } from './types'

// ─── UI-ready types ───────────────────────────────────────────────────────────

/**
 * Flattened, null-safe snapshot used throughout the UI.
 * Derived from AlpacaOptionSnapshot + ParsedOCC.
 * Zero-defaults replace missing fields so components never need to null-check.
 */
export type OptionSnapshot = {
    // ── Identity (from OCC symbol) ───────────────────────────────────────────
    symbol: string            // Full OCC contract symbol, e.g. "NVDA260323C00175000"
    underlying: string            // Underlying ticker, e.g. "NVDA"
    expirationDate: string            // YYYY-MM-DD
    strikePrice: number            // Strike in dollars
    optionType: 'call' | 'put'

    // ── Latest quote (from AlpacaOptionQuote) ─────────────────────────────────
    bid: number  // bp — best bid price
    bidSize: number  // bs — contracts available at best bid
    ask: number  // ap — best ask price
    askSize: number  // as — contracts available at best ask

    // ── Latest trade (from AlpacaOptionTrade) ────────────────────────────────
    last: number     // p  — most recent trade price

    // ── Daily bar (from AlpacaBar: dailyBar) ─────────────────────────────────
    volume: number  // v  — contracts traded today
    dayOpen: number  // o  — first price of the session
    dayHigh: number  // h  — intraday high
    dayLow: number  // l  — intraday low
    dayClose: number  // c  — last price (or current price if session is live)

    // ── Implied volatility ────────────────────────────────────────────────────
    impliedVolatility: number  // annualised IV as a decimal, e.g. 0.45 = 45%

    // ── Greeks (from AlpacaGreeks) ────────────────────────────────────────────
    delta: number  // Δ — price sensitivity to underlying move
    gamma: number  // Γ — delta sensitivity to underlying move
    theta: number  // Θ — daily time decay (negative for long)
    vega: number  // V — sensitivity to 1pp IV change
    rho: number  // ρ — sensitivity to 1pp interest rate change
}

/**
 * A single OHLCV bar as returned by the /bars endpoint.
 * Re-exported directly — the raw AlpacaBar shape is already charting-ready.
 */
export type OptionBar = AlpacaBar

// ─── Server functions ─────────────────────────────────────────────────────────

/**
 * Fetch all option snapshots for an underlying symbol.
 * Endpoint: GET /v1beta1/options/snapshots/{underlying_symbol}
 * Docs: https://docs.alpaca.markets/reference/optionchain
 *
 * Paginates up to 2 pages (2000 contracts). Options without a recognisable
 * OCC symbol are silently skipped.
 *
 * Also fetches the current underlying stock price via /v2/stocks/trades/latest
 * (best-effort — zero if the call fails).
 */
export const fetchOptionChain = createServerFn({ method: 'GET' })
    .inputValidator((input: { symbol: string }) =>
        z.object({ symbol: z.string().min(1).max(10) }).parse(input))
    .handler(async ({ data: { symbol } }) => {
        const underlying = symbol.toUpperCase()

        // ── Paginate snapshots (max 2 pages = 2 000 contracts) ────────────────
        const collected: AlpacaSnapshotsResponse['snapshots'] = {}

        const page1 = await alpacaFetch<AlpacaSnapshotsResponse>(
            `${ALPACA_DATA_BASE}/v1beta1/options/snapshots/${underlying}?feed=indicative&limit=1000`,
        )
        Object.assign(collected, page1.snapshots)

        if (page1.next_page_token) {
            const page2 = await alpacaFetch<AlpacaSnapshotsResponse>(
                `${ALPACA_DATA_BASE}/v1beta1/options/snapshots/${underlying}?feed=indicative&limit=1000&page_token=${page1.next_page_token}`,
            )
            Object.assign(collected, page2.snapshots)
        }

        // ── Underlying spot price (non-critical) ──────────────────────────────
        // Uses /v2/stocks/trades/latest with the IEX feed (free tier compatible)
        let underlyingPrice = 0
        try {
            const stockRes = await alpacaFetch<{ trades: Record<string, { p: number }> }>(
                `${ALPACA_DATA_BASE}/v2/stocks/trades/latest?symbols=${underlying}&feed=iex`,
            )
            underlyingPrice = stockRes.trades?.[underlying]?.p ?? 0
        } catch { /* non-critical — chain still loads without it */ }

        // ── Flatten snapshots into UI-ready OptionSnapshot objects ─────────────
        const options: OptionSnapshot[] = []

        for (const [contractSymbol, snap] of Object.entries(collected)) {
            const parsed = parseOCC(contractSymbol)
            if (!parsed) continue  // skip non-standard symbols

            const q = snap.latestQuote
            const tr = snap.latestTrade
            const d = snap.dailyBar
            const g = snap.greeks

            options.push({
                symbol: contractSymbol,
                underlying: parsed.underlying,
                expirationDate: parsed.expDate,
                strikePrice: parsed.strike,
                optionType: parsed.type,

                bid: q?.bp ?? 0,
                bidSize: q?.bs ?? 0,
                ask: q?.ap ?? 0,
                askSize: q?.as ?? 0,

                last: tr?.p ?? 0,

                volume: d?.v ?? 0,
                dayOpen: d?.o ?? 0,
                dayHigh: d?.h ?? 0,
                dayLow: d?.l ?? 0,
                dayClose: d?.c ?? 0,

                impliedVolatility: snap.impliedVolatility ?? 0,

                delta: g?.delta ?? 0,
                gamma: g?.gamma ?? 0,
                theta: g?.theta ?? 0,
                vega: g?.vega ?? 0,
                rho: g?.rho ?? 0,
            })
        }

        // Sort by expiration date, then by strike price ascending
        options.sort((a, b) =>
            a.expirationDate !== b.expirationDate
                ? a.expirationDate.localeCompare(b.expirationDate)
                : a.strikePrice - b.strikePrice,
        )

        return { options, underlyingPrice, fetchedAt: new Date().toISOString() }
    })

/**
 * Fetch OHLCV bars for a specific option contract.
 * Endpoint: GET /v1beta1/options/bars
 * Docs: https://docs.alpaca.markets/reference/optionbars
 *
 * Note: the /bars endpoint does NOT accept a `feed` parameter (unlike snapshots).
 * Supported timeframes: "1Min" | "5Min" | "1Hour" | "1Day"
 */
export const fetchOptionBars = createServerFn({ method: 'GET' })
    .inputValidator((input: { contractSymbol: string; timeframe: string; start?: string; end?: string }) =>
        z.object({
            contractSymbol: z.string().min(1),
            timeframe: z.enum(['1Min', '5Min', '1Hour', '1Day']).default('1Day'),
            start: z.string().optional(),  // ISO date or RFC-3339 string (inclusive)
            end: z.string().optional(),  // ISO date or RFC-3339 string (inclusive)
        }).parse(input))
    .handler(async ({ data: { contractSymbol, timeframe, start, end } }) => {
        const params = new URLSearchParams({
            symbols: contractSymbol,
            timeframe,
            limit: '500',
            sort: 'asc',   // oldest → newest (required for charting)
        })
        if (start) params.set('start', start)
        if (end) params.set('end', end)

        const json = await alpacaFetch<AlpacaBarsResponse>(
            `${ALPACA_DATA_BASE}/v1beta1/options/bars?${params}`,
        )
        const bars: OptionBar[] = json.bars?.[contractSymbol] ?? []
        return { bars, contractSymbol }
    })
