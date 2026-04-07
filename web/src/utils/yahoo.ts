import { createServerFn } from '@tanstack/react-start'

export type YahooOption = {
    contractSymbol: string
    strike: number
    currency: string
    lastPrice: number
    change: number
    percentChange: number
    volume: number
    openInterest: number
    bid: number
    ask: number
    contractSize: string
    expiration: number
    lastTradeDate: number
    impliedVolatility: number
    inTheMoney: boolean
}

export type StrikeMetrics = {
    strike: number
    callOpenInterest: number
    putOpenInterest: number
    callVolume: number
    putVolume: number
    totalOpenInterest: number
    totalVolume: number
}

export type MaxPainResult = {
    strike: number
    callValue: number
    putValue: number
    totalValue: number
}

export type GexPoint = {
    strike: number
    callGex: number
    putGex: number
    totalGex: number
}

export type VolPoint = {
    strike: number
    iv: number
}

export type ChainSideStats = {
    maxLastPrice: number
    maxIntrinsic: number
    maxExtrinsic: number
    maxIV: number
    maxVolume: number
    maxOI: number
}

export type ChainStats = {
    call: ChainSideStats
    put: ChainSideStats
}

export type YahooOptionChainEntry = {
    expirationDate: number
    hasMiniOptions: boolean
    calls: YahooOption[]
    puts: YahooOption[]
    strikeMetrics: StrikeMetrics[]
    maxPain: MaxPainResult | null
    gexByOI: GexPoint[]
    gexByVolume: GexPoint[]
    callVolCurve: VolPoint[]
    putVolCurve: VolPoint[]
    chainStats: ChainStats
}

export type YahooOptionChainResult = {
    underlyingSymbol: string
    expirationDates: number[]
    strikes: number[]
    hasMiniOptions: boolean
    quote: {
        language: string
        region: string
        quoteType: string
        typeDisp: string
        quoteSourceName: string
        triggerable: boolean
        customPriceAlertConfidence: string
        regularMarketChangePercent: number
        regularMarketPrice: number
        regularMarketDayHigh: number
        regularMarketDayLow: number
        regularMarketVolume: number
    }
    options: YahooOptionChainEntry[]
}

// Raw types for deserializing the Yahoo Finance API response before enrichment
type RawChainEntry = Omit<YahooOptionChainEntry, 'strikeMetrics' | 'maxPain' | 'gexByOI' | 'gexByVolume' | 'callVolCurve' | 'putVolCurve' | 'chainStats'>
type RawResult = Omit<YahooOptionChainResult, 'options'> & { options: RawChainEntry[] }
type YahooResponse = {
    optionChain: {
        result: RawResult[]
        error: unknown
    }
}

let cachedCrumb: string | null = null
let cachedCookie: string | null = null

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
const symbolMap: Record<string, string> = {
    SPX: '^SPX',
    NDX: '^NDX',
    DJI: '^DJI',
    VIX: '^VIX',
}

async function getSession(): Promise<{ crumb: string | null, cookie: string | null }> {
    if (cachedCrumb && cachedCookie) return { crumb: cachedCrumb, cookie: cachedCookie }

    try {
        // Step 1: Get cookies from Yahoo's lightweight cookie endpoint
        const response1 = await fetch('https://fc.yahoo.com', {
            headers: { 'User-Agent': USER_AGENT }
        })

        const cookie = response1.headers.getSetCookie
            ? response1.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
            : response1.headers.get('set-cookie')

        if (!cookie) {
            console.warn('Yahoo: No cookie received')
            return { crumb: null, cookie: null }
        }

        // Step 2: Get crumb using the cookies
        const response2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
            headers: {
                'Cookie': cookie,
                'User-Agent': USER_AGENT
            }
        })

        if (!response2.ok) {
            console.warn('Yahoo: Failed to get crumb', response2.status)
            return { crumb: null, cookie: null }
        }

        const crumb = await response2.text()
        cachedCrumb = crumb
        cachedCookie = cookie
        return { crumb, cookie }
    } catch (e) {
        console.error('Yahoo Session Error:', e)
        return { crumb: null, cookie: null }
    }
}

function resolveYahooSymbol(symbol: string): string {
    const upperSymbol = symbol.toUpperCase()
    return symbolMap[upperSymbol] ?? upperSymbol
}

function buildOptionChainUrl(yahooSymbol: string, crumb: string | null, date?: number): string {
    const params = new URLSearchParams()
    if (typeof date === 'number') {
        params.set('date', String(date))
    }
    if (crumb) {
        params.set('crumb', crumb)
    }
    const query = params.toString()
    return `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(yahooSymbol)}${query ? `?${query}` : ''}`
}

// ============================================================================
// Backend computations — run once at fetch time, stored on the chain entry
// ============================================================================

function computeStrikeMetrics(calls: YahooOption[], puts: YahooOption[]): StrikeMetrics[] {
    const strikeMap = new Map<number, StrikeMetrics>()

    const upsert = (strike: number): StrikeMetrics => {
        const existing = strikeMap.get(strike)
        if (existing) return existing
        const next: StrikeMetrics = { strike, callOpenInterest: 0, putOpenInterest: 0, callVolume: 0, putVolume: 0, totalOpenInterest: 0, totalVolume: 0 }
        strikeMap.set(strike, next)
        return next
    }

    calls.forEach(o => {
        const s = upsert(o.strike)
        s.callOpenInterest += Math.max(0, o.openInterest ?? 0)
        s.callVolume += Math.max(0, o.volume ?? 0)
        s.totalOpenInterest = s.callOpenInterest + s.putOpenInterest
        s.totalVolume = s.callVolume + s.putVolume
    })

    puts.forEach(o => {
        const s = upsert(o.strike)
        s.putOpenInterest += Math.max(0, o.openInterest ?? 0)
        s.putVolume += Math.max(0, o.volume ?? 0)
        s.totalOpenInterest = s.callOpenInterest + s.putOpenInterest
        s.totalVolume = s.callVolume + s.putVolume
    })

    return Array.from(strikeMap.values())
        .filter(s => s.totalOpenInterest > 0 || s.totalVolume > 0)
        .sort((a, b) => a.strike - b.strike)
}

function aggregateOI(options: YahooOption[]): Map<number, number> {
    const map = new Map<number, number>()
    options.forEach(o => {
        if (!Number.isFinite(o.strike)) return
        const oi = Math.max(0, o.openInterest ?? 0)
        if (oi <= 0) return
        map.set(o.strike, (map.get(o.strike) ?? 0) + oi)
    })
    return map
}

function computeMaxPain(calls: YahooOption[], puts: YahooOption[]): MaxPainResult | null {
    const callBuckets = aggregateOI(calls)
    const putBuckets = aggregateOI(puts)

    const strikes = Array.from(new Set([...callBuckets.keys(), ...putBuckets.keys()])).sort((a, b) => a - b)
    if (strikes.length === 0) return null

    let best: MaxPainResult | null = null

    for (const settlement of strikes) {
        let callValue = 0
        let putValue = 0

        callBuckets.forEach((oi, strike) => {
            if (oi > 0 && strike < settlement) callValue += (settlement - strike) * oi * 100
        })
        putBuckets.forEach((oi, strike) => {
            if (oi > 0 && strike > settlement) putValue += (strike - settlement) * oi * 100
        })

        const total = callValue + putValue
        if (!best || total < best.totalValue || (total === best.totalValue && settlement < best.strike)) {
            best = { strike: settlement, callValue, putValue, totalValue: total }
        }
    }

    return best
}

function computeGex(calls: YahooOption[], puts: YahooOption[], spotPrice: number, source: 'openInterest' | 'volume'): GexPoint[] {
    const now = Date.now() / 1000
    const strikeMap = new Map<number, { callGex: number; putGex: number }>()

    const process = (option: YahooOption, isCall: boolean) => {
        const weight = (source === 'volume' ? option.volume : option.openInterest) ?? 0
        if (weight <= 0) return
        const iv = option.impliedVolatility ?? 0
        if (iv <= 0) return

        const dt = new Date(option.expiration * 1000)
        const isEDT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).format(dt).includes('EDT')
        const utcMidnight = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) / 1000
        const preciseExpiration = utcMidnight + (16 + (isEDT ? 4 : 5)) * 3600

        const T = (preciseExpiration - now) / (365 * 24 * 3600)
        if (T <= 0) return

        const d1 = (Math.log(spotPrice / option.strike) + (0.05 + 0.5 * iv * iv) * T) / (iv * Math.sqrt(T))
        const nd1 = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * d1 * d1)
        const gamma = nd1 / (spotPrice * iv * Math.sqrt(T))
        const gexValue = gamma * weight * 100 * spotPrice * 0.01 * spotPrice

        const existing = strikeMap.get(option.strike) ?? { callGex: 0, putGex: 0 }
        if (isCall) existing.callGex += gexValue
        else existing.putGex += gexValue
        strikeMap.set(option.strike, existing)
    }

    calls.forEach(o => process(o, true))
    puts.forEach(o => process(o, false))

    return Array.from(strikeMap.entries())
        .map(([strike, data]) => ({ strike, callGex: data.callGex, putGex: data.putGex, totalGex: data.callGex - data.putGex }))
        .sort((a, b) => a.strike - b.strike)
}

function computeVolCurve(options: YahooOption[]): VolPoint[] {
    const strikeMap = new Map<number, { sum: number; count: number }>()

    options.forEach(o => {
        if (!Number.isFinite(o.strike) || !Number.isFinite(o.impliedVolatility) || o.impliedVolatility <= 0) return
        const existing = strikeMap.get(o.strike) ?? { sum: 0, count: 0 }
        existing.sum += o.impliedVolatility * 100
        existing.count += 1
        strikeMap.set(o.strike, existing)
    })

    return Array.from(strikeMap.entries())
        .map(([strike, e]) => ({ strike, iv: e.sum / e.count }))
        .sort((a, b) => a.strike - b.strike)
}

function computeChainStats(calls: YahooOption[], puts: YahooOption[], spotPrice: number): ChainStats {
    const maxOf = (nums: number[]) => nums.length === 0 ? 0 : Math.max(0, ...nums)
    const callIntrinsic = (strike: number) => Math.max(0, spotPrice - strike)
    const putIntrinsic = (strike: number) => Math.max(0, strike - spotPrice)

    return {
        call: {
            maxLastPrice: maxOf(calls.map(o => o.lastPrice ?? 0)),
            maxIntrinsic: maxOf(calls.map(o => callIntrinsic(o.strike))),
            maxExtrinsic: maxOf(calls.map(o => Math.max(0, (o.lastPrice ?? 0) - callIntrinsic(o.strike)))),
            maxIV: maxOf(calls.map(o => (o.impliedVolatility ?? 0) * 100)),
            maxVolume: maxOf(calls.map(o => o.volume ?? 0)),
            maxOI: maxOf(calls.map(o => o.openInterest ?? 0)),
        },
        put: {
            maxLastPrice: maxOf(puts.map(o => o.lastPrice ?? 0)),
            maxIntrinsic: maxOf(puts.map(o => putIntrinsic(o.strike))),
            maxExtrinsic: maxOf(puts.map(o => Math.max(0, (o.lastPrice ?? 0) - putIntrinsic(o.strike)))),
            maxIV: maxOf(puts.map(o => (o.impliedVolatility ?? 0) * 100)),
            maxVolume: maxOf(puts.map(o => o.volume ?? 0)),
            maxOI: maxOf(puts.map(o => o.openInterest ?? 0)),
        },
    }
}

function enrichChainEntry(raw: RawChainEntry, spotPrice: number): YahooOptionChainEntry {
    return {
        ...raw,
        strikeMetrics: computeStrikeMetrics(raw.calls, raw.puts),
        maxPain: computeMaxPain(raw.calls, raw.puts),
        gexByOI: spotPrice > 0 ? computeGex(raw.calls, raw.puts, spotPrice, 'openInterest') : [],
        gexByVolume: spotPrice > 0 ? computeGex(raw.calls, raw.puts, spotPrice, 'volume') : [],
        callVolCurve: computeVolCurve(raw.calls),
        putVolCurve: computeVolCurve(raw.puts),
        chainStats: computeChainStats(raw.calls, raw.puts, spotPrice),
    }
}

async function fetchYahooOptionChain(symbol: string, date?: number): Promise<YahooOptionChainResult> {
    let { crumb, cookie } = await getSession()

    const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
    if (cookie) headers.Cookie = cookie

    const yahooSymbol = resolveYahooSymbol(symbol)
    let response = await fetch(buildOptionChainUrl(yahooSymbol, crumb, date), { headers })

    if (response.status === 401) {
        console.warn('Yahoo: Session expired, refreshing...')
        cachedCrumb = null
        cachedCookie = null

        const refreshed = await getSession()
        crumb = refreshed.crumb
        cookie = refreshed.cookie

        const retryHeaders: Record<string, string> = { 'User-Agent': USER_AGENT }
        if (cookie) retryHeaders.Cookie = cookie
        response = await fetch(buildOptionChainUrl(yahooSymbol, crumb, date), { headers: retryHeaders })
    }

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`Failed to fetch options data (${response.status}): ${text.slice(0, 100)}`)
    }

    const data: YahooResponse = await response.json()
    const raw = data.optionChain.result[0]

    if (!raw) throw new Error(`No option data found for ${symbol.toUpperCase()}`)

    const spotPrice = raw.quote.regularMarketPrice
    return {
        ...raw,
        options: raw.options.map(entry => enrichChainEntry(entry, spotPrice)),
    }
}

export const getOptionOpenInterestData = createServerFn({ method: 'GET' })
    .inputValidator((data: { symbol: string; date?: number }) => data)
    .handler(async ({ data }) => {
        return await fetchYahooOptionChain(data.symbol, data.date)
    })
