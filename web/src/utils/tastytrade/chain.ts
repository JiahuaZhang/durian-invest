import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { tastytradeFetch } from './client'
import type {
    TTExpiry,
    TTFutureInfo,
    TTMarketDataItem,
    TTMarketDataResponse,
    TTNestedChainResponse,
} from './types'

/**
 * Fetch the nested futures option chain for a product code (e.g. "GC" for Gold).
 * Returns all available expirations with their strikes and call/put symbols.
 * Does NOT require a funded account.
 */
export const fetchTTChain = createServerFn({ method: 'GET' })
    .inputValidator((input: { symbol: string }) =>
        z.object({
            symbol: z.string().min(1).max(10).transform(s => s.toUpperCase()),
        }).parse(input))
    .handler(async ({ data: { symbol } }) => {
        const json = await tastytradeFetch<TTNestedChainResponse>(
            `/futures-option-chains/${symbol}/nested`,
        )

        const chains = json.data['option-chains'] ?? []

        // Flatten all expirations, dedup by date+underlying
        const seen = new Set<string>()
        const expirations: TTExpiry[] = []

        for (const chain of chains) {
            for (const exp of chain.expirations) {
                const key = exp['expiration-date'] + exp['underlying-symbol']
                if (seen.has(key)) continue
                seen.add(key)

                expirations.push({
                    date: exp['expiration-date'],
                    dte: exp['days-to-expiration'],
                    expiryType: exp['expiration-type'],
                    settlementType: exp['settlement-type'],
                    exerciseStyle: chain['exercise-style'],
                    underlyingSymbol: exp['underlying-symbol'],
                    contractSymbol: exp['option-contract-symbol'],
                    optionRootSymbol: exp['option-root-symbol'],
                    strikes: exp.strikes
                        .map(s => ({
                            strike: parseFloat(s['strike-price']),
                            callSymbol: s.call,
                            putSymbol: s.put,
                            call: null,
                            put: null,
                        }))
                        .sort((a, b) => a.strike - b.strike),
                })
            }
        }

        expirations.sort((a, b) =>
            a.date !== b.date ? a.date.localeCompare(b.date) : a.dte - b.dte,
        )

        const futures: TTFutureInfo[] = (json.data.futures ?? []).map(f => ({
            symbol: f.symbol,
            expirationDate: f['expiration-date'],
            dte: f['days-to-expiration'],
            isActiveMonth: f['active-month'],
            isNextActiveMonth: f['next-active-month'],
            stopsTradingAt: f['stops-trading-at'],
            expiresAt: f['expires-at'],
        }))

        return { expirations, futures, symbol, fetchedAt: new Date().toISOString() }
    })

/**
 * Fetch live market data for a list of futures option symbols.
 * Returns an empty map gracefully if the account is not funded (403/error).
 * Endpoint: GET /market-data/by-type?future-option=SYM1,SYM2,...
 */
export const fetchTTMarketData = createServerFn({ method: 'GET' })
    .inputValidator((input: { symbols: string[] }) =>
        z.object({
            symbols: z.array(z.string()).min(1).max(500),
        }).parse(input))
    .handler(async ({ data: { symbols } }) => {
        try {
            const query = symbols.map(encodeURIComponent).join(',')
            const json = await tastytradeFetch<TTMarketDataResponse>(
                `/market-data/by-type?future-option=${query}`,
            )
            const map: Record<string, TTMarketDataItem> = {}
            for (const item of json.data?.items ?? []) {
                map[item.symbol] = item
            }
            return map
        } catch {
            // Market data requires a funded account — degrade silently
            return {} as Record<string, TTMarketDataItem>
        }
    })
