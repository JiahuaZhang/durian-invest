import type { YahooOptionChainEntry, YahooOptionChainResult } from '@/utils/yahoo'

export function getFirstChain(result: YahooOptionChainResult | null): YahooOptionChainEntry | null {
    if (!result || result.options.length === 0) return null
    return result.options[0]
}

export function findChainForDate(result: YahooOptionChainResult | null, date: number): YahooOptionChainEntry | null {
    if (!result || result.options.length === 0) return null
    return result.options.find(option => option.expirationDate === date) ?? null
}

export function clearSymbolCache(cache: Map<string, YahooOptionChainResult>, symbol: string) {
    const prefix = `${symbol}|`
    Array.from(cache.keys()).forEach(key => {
        if (key.startsWith(prefix)) {
            cache.delete(key)
        }
    })
}

export function buildCacheKey(symbol: string, date?: number): string {
    return `${symbol}|${date ?? 'default'}`
}

export function findTickLabel(labels: Map<number, string>, value: number): string | undefined {
    if (labels.has(value)) return labels.get(value)
    for (const [key, label] of labels.entries()) {
        if (Math.abs(key - value) < 1e-6) return label
    }
    return undefined
}

export function formatCompactNumber(value: number): string {
    const sign = value < 0 ? '-' : ''
    const absolute = Math.abs(value)
    if (absolute >= 1_000_000_000) return `${sign}${(absolute / 1_000_000_000).toFixed(1)}B`
    if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(1)}M`
    if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(1)}K`
    return `${sign}${Math.round(absolute)}`
}

export function formatStrike(strike: number): string {
    if (!Number.isFinite(strike)) return ''
    if (Number.isInteger(strike)) return `${strike}`
    return strike.toFixed(2)
}

export function formatExpirationDate(expirationDate: number, showDetails = false): string {
    const expDate = new Date(expirationDate * 1000)
    const dateStr = expDate.toISOString().split('T')[0]

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayOfWeek = days[expDate.getUTCDay()]

    const dateOfMonth = expDate.getUTCDate()
    const isOPEX = expDate.getUTCDay() === 5 && dateOfMonth >= 15 && dateOfMonth <= 21

    const now = new Date()
    const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const expUtc = Date.UTC(expDate.getUTCFullYear(), expDate.getUTCMonth(), expDate.getUTCDate())

    const diffDays = Math.round((expUtc - nowUtc) / (1000 * 60 * 60 * 24))

    let daysStr = ''
    if (diffDays === 0) {
        daysStr = 'today'
    } else if (diffDays === 1) {
        daysStr = '1 day'
    } else if (diffDays === -1) {
        daysStr = '-1 day'
    } else {
        daysStr = `${diffDays} days`
    }

    if (!showDetails) return dateStr

    const detailParts = [daysStr, dayOfWeek]
    if (isOPEX) detailParts.push('OPEX')
    return `${dateStr} (${detailParts.join(' ')})`
}
