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

export type YahooOptionChainEntry = {
    expirationDate: number
    hasMiniOptions: boolean
    calls: YahooOption[]
    puts: YahooOption[]
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

type YahooResponse = {
    optionChain: {
        result: YahooOptionChainResult[]
        error: unknown
    }
}

export type GexStrikeData = {
    strike: number
    callGex: number
    putGex: number
    totalGex: number
    callOi: number
    putOi: number
}

export type GexProfile = {
    symbol: string
    price: number
    totalNetGex: number
    zeroGexStrike: number
    strikes: GexStrikeData[]
    expirationDate: string
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
    const result = data.optionChain.result[0]

    if (!result) throw new Error(`No option data found for ${symbol.toUpperCase()}`)

    return result
}

export const getOptionOpenInterestData = createServerFn({ method: 'GET' })
    .inputValidator((data: { symbol: string; date?: number }) => data)
    .handler(async ({ data }) => {
        return await fetchYahooOptionChain(data.symbol, data.date)
    })


/**
 * Estimates Gamma for an option given its properties.
 * Using a simplified Black-Scholes approximation.
 */
function calculateGamma(
    S: number, // Spot Price
    K: number, // Strike Price
    T: number, // Time to expiration in years
    sigma: number, // Implied Volatility
    r: number = 0.05 // Risk free rate (approx)
): number {
    if (T <= 0 || sigma === 0 || S === 0) return 0

    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
    const nd1 = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * d1 * d1)

    return nd1 / (S * sigma * Math.sqrt(T))
}

export const getGexData = createServerFn({ method: "GET" })
    .inputValidator((symbol: string) => symbol)
    .handler(async ({ data: symbol }) => {
        const result = await fetchYahooOptionChain(symbol)
        if (!result.options || result.options.length === 0) {
            throw new Error(`No options chain available for ${symbol.toUpperCase()}. Try SPY or QQQ instead.`)
        }

        const currentPrice = result.quote.regularMarketPrice
        const now = Date.now() / 1000

        const strikeMap = new Map<number, GexStrikeData>()

        const processOption = (opt: YahooOption, isCall: boolean) => {
            if (!opt.openInterest) return

            const T = (opt.expiration - now) / (365 * 24 * 3600)
            const iv = opt.impliedVolatility || 0

            const gamma = calculateGamma(currentPrice, opt.strike, T, iv)
            const gexVal = gamma * opt.openInterest * 100 * currentPrice

            const existing = strikeMap.get(opt.strike) || {
                strike: opt.strike,
                callGex: 0,
                putGex: 0,
                totalGex: 0,
                callOi: 0,
                putOi: 0
            }

            if (isCall) {
                existing.callGex += gexVal
                existing.callOi += opt.openInterest
            } else {
                existing.putGex += gexVal
                existing.putOi += opt.openInterest
            }

            strikeMap.set(opt.strike, existing)
        }

        result.options.forEach(chain => {
            chain.calls.forEach(o => processOption(o, true))
            chain.puts.forEach(o => processOption(o, false))
        })

        const strikes = Array.from(strikeMap.values()).map(s => ({
            ...s,
            totalGex: s.callGex - s.putGex
        })).sort((a, b) => a.strike - b.strike)

        const totalNetGex = strikes.reduce((sum, s) => sum + s.totalGex, 0)

        return {
            symbol: result.underlyingSymbol,
            price: currentPrice,
            totalNetGex,
            zeroGexStrike: 0,
            strikes,
            expirationDate: new Date(result.options[0].expirationDate * 1000).toLocaleDateString()
        }
    })
