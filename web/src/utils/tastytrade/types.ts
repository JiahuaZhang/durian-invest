// ── Raw tastytrade API response shapes ────────────────────────────────────────

export type TTStrike = {
    'strike-price': string
    'call': string   // full option symbol, e.g. "./GCM5 OG5M5 250527C4200"
    'put': string
}

export type TTExpiration = {
    'underlying-symbol': string       // e.g. "/GCM5"
    'root-symbol': string             // e.g. "/GC"
    'option-root-symbol': string      // e.g. "OG"
    'option-contract-symbol': string  // e.g. "OGM5"
    'expiration-date': string         // YYYY-MM-DD
    'days-to-expiration': number
    'expiration-type': string         // "Weekly" | "Monthly" | "Quarterly"
    'settlement-type': string         // "PM" | "AM" | "EOM"
    'strikes': TTStrike[]
}

export type TTOptionChain = {
    'underlying-symbol': string
    'root-symbol': string
    'exercise-style': string          // "American" | "European"
    'expirations': TTExpiration[]
}

export type TTFuture = {
    'symbol': string             // e.g. "/GCM5"
    'root-symbol': string        // e.g. "/GC"
    'expiration-date': string
    'days-to-expiration': number
    'active-month': boolean
    'next-active-month': boolean
    'stops-trading-at': string   // ISO datetime
    'expires-at': string         // ISO datetime
}

export type TTNestedChainResponse = {
    data: {
        futures: TTFuture[]
        'option-chains': TTOptionChain[]
    }
    context: string
}

export type TTMarketDataItem = {
    symbol: string
    'instrument-type': string
    bid?: number
    'bid-size'?: number
    ask?: number
    'ask-size'?: number
    mid?: number
    mark?: number
    last?: number
    // Greeks — funded accounts only
    delta?: number
    gamma?: number
    theta?: number
    vega?: number
    'implied-volatility'?: number
}

export type TTMarketDataResponse = {
    data: {
        items: TTMarketDataItem[]
    }
}

// ── UI-ready types ─────────────────────────────────────────────────────────────

export type TTStrikeRow = {
    strike: number
    callSymbol: string
    putSymbol: string
    call: TTMarketDataItem | null
    put: TTMarketDataItem | null
}

export type TTExpiry = {
    date: string               // YYYY-MM-DD
    dte: number
    expiryType: string         // "Weekly" | "Monthly" | "Quarterly"
    settlementType: string     // "PM" | "AM" | "EOM"
    exerciseStyle: string      // "American" | "European"
    underlyingSymbol: string   // e.g. "/GCM5"
    contractSymbol: string     // e.g. "OGM5"
    optionRootSymbol: string   // e.g. "OG"
    strikes: TTStrikeRow[]
}

export type TTFutureInfo = {
    symbol: string             // e.g. "/GCM5"
    expirationDate: string
    dte: number
    isActiveMonth: boolean
    isNextActiveMonth: boolean
    stopsTradingAt: string
    expiresAt: string
}
