import { createServerFn } from '@tanstack/react-start'

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
    tradeTime: string
}

type RawRecord = Record<string, string | number | Record<string, unknown>>

type BarchartApiResponse = {
    count: number
    total: number
    data: RawRecord[]
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const FIELDS = [
    'symbol', 'baseLastPrice', 'strikePrice', 'expirationDate',
    'daysToExpiration', 'putCall', 'bidPrice', 'lastPrice', 'askPrice',
    'volume', 'openInterest', 'volumeOpenInterestRatio',
    'tradeTime', 'moneyness', 'delta',
].join(',')

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

/**
 * Detect Call/Put from the barchart option symbol convention.
 * Symbol format: "AAPL|20260417|170.00C" — last char is C (Call) or P (Put)
 */
function detectPutCall(symbol: string, putCallField: unknown): 'Call' | 'Put' {
    if (putCallField === 'Put' || putCallField === 'Call') return putCallField
    // Check last character of the full symbol (before parsing)
    const lastChar = symbol.slice(-1).toUpperCase()
    return lastChar === 'P' ? 'Put' : 'Call'
}

export const fetchUnusualOptions = createServerFn({ method: 'GET' })
    .handler(async () => {
        const { cookies, xsrfToken } = await fetchWithAuth()

        const params = new URLSearchParams({
            fields: FIELDS,
            baseSymbolTypes: 'stock',
            orderBy: 'volumeOpenInterestRatio',
            orderDir: 'desc',
            limit: '200',
            meta: 'field.shortName,field.type,field.description',
            raw: '1',
        })
        params.append('between(volumeOpenInterestRatio,1.24,)', '')

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
            // Each record has a 'raw' property with actual numeric values
            const raw = (record.raw ?? {}) as Record<string, unknown>
            const fullSymbol = String(raw.symbol ?? record.symbol ?? '')
            const ticker = fullSymbol.split('|')[0]

            return {
                symbol: ticker,
                baseLastPrice: Number(raw.baseLastPrice ?? 0),
                expirationDate: String(record.expirationDate ?? ''),
                daysToExpiration: Number(raw.daysToExpiration ?? 0),
                putCall: detectPutCall(fullSymbol, record.putCall),
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
        })

        return {
            options,
            total: json.total ?? options.length,
            fetchedAt: new Date().toISOString(),
        }
    })
