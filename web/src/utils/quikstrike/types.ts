// ── QuikStrike Data Types ─────────────────────────────────────────────────────
// QuikStrike is CME's options analytics tool (cmegroup-sso.quikstrike.net).
// Authentication is SAML2 SSO; data is fetched via cookie-based session proxy.

/** One side (call or put) of a strike row, normalized from QuikStrike's API. */
export type QSLeg = {
    symbol: string        // e.g. "G1MJ6 4350 P"
    strike: number
    type: 'C' | 'P' | 'S'  // Call / Put / Straddle (ATM combined)
    prem: number          // mid-market premium
    vol: number           // IV as percent (42.34 means 42.34%)
    delta: number
    oi: number
    volume: number
    bid?: number
    ask?: number
    theta?: number
    gamma?: number
    vega?: number
    rho?: number
}

/** A single strike row containing call and put sides. */
export type QSStrikeRow = {
    strike: number
    call: QSLeg | null
    put: QSLeg | null
}

/** Full chain result for one expiry. */
export type QSChainResult = {
    product: string       // e.g. "OG"
    expiry: string        // e.g. "G1MJ6"
    futuresCode: string   // e.g. "GC"
    futuresPrice: number
    futuresChange: number
    dte: number
    putVolume: number
    callVolume: number
    iv: number            // ATM IV (percent)
    ivChange: number      // IV change from settle
    strikes: QSStrikeRow[]
    fetchedAt: string
    // Debug / discovery fields
    _endpoint?: string
    _raw?: unknown
}

/** Result from probing multiple endpoint patterns. */
export type QSProbeEntry = {
    endpoint: string
    method: 'GET' | 'POST'
    status: number
    preview: string
    isJson: boolean
    error?: string
}

/** CME product descriptor for the product selector. */
export type QSProductInfo = {
    label: string         // e.g. "Gold (OG|GC)"
    optRoot: string       // e.g. "OG"
    futRoot: string       // e.g. "GC"
    pf: number            // product family code for QuikStrike URL
    pid: number           // page ID (40 = Options Info)
    defaultExpiry?: string
}
