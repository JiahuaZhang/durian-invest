import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export type UnusualOption = {
    symbol: string
    baseLastPrice: number
    expirationDate: string
    daysToExpiration: number
    putCall: 'Call' | 'Put'
    strikePrice: number
    moneyness: number
    bidPrice: number
    lastPrice: number
    askPrice: number
    volume: number
    openInterest: number
    volumeOpenInterestRatio: number
    delta: number
    gamma?: number
    theta?: number
    vega?: number
    rho?: number
    tradeTime: string
}

export const querySchema = z.object({
    assetType: z.enum(['stock', 'etf', 'index', 'stock,etf', 'stock,etf,index']).default('stock'),
    orderBy: z.string().default('volumeOpenInterestRatio'),
    orderDir: z.enum(['asc', 'desc']).default('desc'),
    limit: z.number().min(1).max(1000).default(200),
    minVolOI: z.number().min(0).default(1.24),
    minVolume: z.number().min(0).default(0),
    maxDTE: z.number().min(0).default(0),
    showGreeks: z.boolean().default(false),
})

export type QueryParams = z.infer<typeof querySchema>

type RawRecord = Record<string, string | number | Record<string, unknown>>

type BarchartApiResponse = {
    count: number
    total: number
    data: RawRecord[]
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const BASE_FIELDS = [
    'symbol', 'baseLastPrice', 'strikePrice', 'expirationDate',
    'daysToExpiration', 'symbolType', 'bidPrice', 'lastPrice', 'askPrice',
    'volume', 'openInterest', 'volumeOpenInterestRatio',
    'tradeTime', 'moneyness', 'delta',
]

const GREEK_FIELDS = ['gamma', 'theta', 'vega', 'rho']

async function fetchWithAuth(): Promise<{ cookies: string; xsrfToken: string }> {
    const res = await fetch('https://www.barchart.com/options/unusual-activity/stocks', {
        headers: { 'User-Agent': USER_AGENT },
    })

    if (!res.ok) {
        throw new Error(`Failed to fetch barchart page: ${res.status}`)
    }

    await res.text()

    const rawCookies = res.headers.getSetCookie?.() ?? []
    const cookies = rawCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ')

    const xsrfMatch = cookies.match(/XSRF-TOKEN=([^;,\s]+)/)
    const xsrfToken = xsrfMatch ? decodeURIComponent(xsrfMatch[1]) : ''

    if (!xsrfToken) {
        throw new Error('Could not extract XSRF token from barchart cookies')
    }

    return { cookies, xsrfToken }
}

export const fetchUnusualOptions = createServerFn({ method: 'GET' })
    .inputValidator((input?: QueryParams) => querySchema.parse(input ?? {}))
    .handler(async ({ data: q }) => {
        const { cookies, xsrfToken } = await fetchWithAuth()

        const fields = q.showGreeks
            ? [...BASE_FIELDS, ...GREEK_FIELDS].join(',')
            : BASE_FIELDS.join(',')

        const params = new URLSearchParams({
            fields,
            baseSymbolTypes: q.assetType,
            orderBy: q.orderBy,
            orderDir: q.orderDir,
            limit: String(q.limit),
            meta: 'field.shortName,field.type,field.description',
            raw: '1',
        })

        // Vol/OI ratio filter
        if (q.minVolOI > 0) {
            params.append(`between(volumeOpenInterestRatio,${q.minVolOI},)`, '')
        }

        // Volume filter
        if (q.minVolume > 0) {
            params.append(`between(volume,${q.minVolume},)`, '')
        }

        // DTE filter
        if (q.maxDTE > 0) {
            params.append(`between(daysToExpiration,0,${q.maxDTE})`, '')
        }

        const apiUrl = `https://www.barchart.com/proxies/core-api/v1/options/get?${params.toString()}`

        const apiRes = await fetch(apiUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json',
                'X-XSRF-TOKEN': xsrfToken,
                'Cookie': cookies,
                'Referer': 'https://www.barchart.com/options/unusual-activity/stocks',
            },
        })

        if (!apiRes.ok) {
            const text = await apiRes.text()
            throw new Error(`Barchart API error (${apiRes.status}): ${text.slice(0, 200)}`)
        }

        const json: BarchartApiResponse = await apiRes.json()

        if (!json.data || !Array.isArray(json.data)) {
            throw new Error('Unexpected API response format')
        }

        const options: UnusualOption[] = json.data.map(record => {
            const raw = (record.raw ?? {}) as Record<string, unknown>
            const fullSymbol = String(raw.symbol ?? record.symbol ?? '')
            const ticker = fullSymbol.split('|')[0]

            // symbolType returns "Call" / "Put" directly
            const symbolType = String(record.symbolType ?? '')
            const putCall: 'Call' | 'Put' = symbolType === 'Put' ? 'Put'
                : symbolType === 'Call' ? 'Call'
                    : fullSymbol.slice(-1).toUpperCase() === 'P' ? 'Put' : 'Call'

            const opt: UnusualOption = {
                symbol: ticker,
                baseLastPrice: Number(raw.baseLastPrice ?? 0),
                expirationDate: String(record.expirationDate ?? ''),
                daysToExpiration: Number(raw.daysToExpiration ?? 0),
                putCall,
                strikePrice: Number(raw.strikePrice ?? 0),
                moneyness: Number(raw.moneyness ?? 0),
                bidPrice: Number(raw.bidPrice ?? 0),
                lastPrice: Number(raw.lastPrice ?? 0),
                askPrice: Number(raw.askPrice ?? 0),
                volume: Number(raw.volume ?? 0),
                openInterest: Number(raw.openInterest ?? 0),
                volumeOpenInterestRatio: Number(raw.volumeOpenInterestRatio ?? 0),
                delta: Number(raw.delta ?? 0),
                tradeTime: String(record.tradeTime ?? ''),
            }

            if (q.showGreeks) {
                opt.gamma = Number(raw.gamma ?? 0)
                opt.theta = Number(raw.theta ?? 0)
                opt.vega = Number(raw.vega ?? 0)
                opt.rho = Number(raw.rho ?? 0)
            }

            return opt
        })

        return {
            options,
            total: json.total ?? options.length,
            fetchedAt: new Date().toISOString(),
            query: q,
        }
    })
