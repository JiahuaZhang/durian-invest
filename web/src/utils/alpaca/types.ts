/**
 * Alpaca Markets — Options API raw response types
 *
 * Sources:
 *   Snapshots : https://docs.alpaca.markets/reference/optionchain
 *   Bars      : https://docs.alpaca.markets/reference/optionbars
 *   Trades    : https://docs.alpaca.markets/reference/optiontrades
 *
 * All timestamps are RFC-3339 strings with nanosecond precision.
 * All prices are per-contract (multiply by 100 for notional value).
 * All price values are in USD unless the response `currency` field says otherwise.
 */

// ─── Quote ───────────────────────────────────────────────────────────────────

/**
 * Latest NBBO (National Best Bid and Offer) quote for an option contract.
 * Sourced from the OPRA feed (real-time) or the indicative feed (15-min delay).
 */
export type AlpacaOptionQuote = {
    t: string  // Timestamp      — RFC-3339 with nanosecond precision, e.g. "2026-03-20T19:59:59.509356343Z"
    bx: string  // Bid exchange   — exchange code where the best bid originates, e.g. "B" (BOX), "W" (CBOE)
    bp: number  // Bid price      — best bid price for the contract
    bs: number  // Bid size       — number of contracts available at the best bid
    ax: string  // Ask exchange   — exchange code where the best ask originates
    ap: number  // Ask price      — best ask price for the contract
    as: number  // Ask size       — number of contracts available at the best ask
    c: string  // Condition      — quote condition code; " " = normal, "A" = AutoExec eligible, "O" = opening, "R" = regular
}

// ─── Trade ───────────────────────────────────────────────────────────────────

/**
 * A single executed trade for an option contract.
 */
export type AlpacaOptionTrade = {
    t: string    // Timestamp   — RFC-3339 with nanosecond precision
    x: string    // Exchange    — exchange code where the trade was executed, e.g. "C" (CBOE), "N" (NYSE Arca), "A" (NYSE MKT)
    p: number    // Price       — trade price per contract (not multiplied by 100)
    s: number    // Size        — number of contracts traded in this print
    c: string[]  // Conditions  — array of condition codes, e.g. ["I"] = implied, ["g"] = extended hours
    tc?: string    // Tape cond.  — tape condition indicator; "I" = late/out-of-sequence, "j" = next-day, "k" = seller
    i?: number    // Trade ID    — unique numeric identifier for this trade
}

// ─── Bar (OHLCV aggregate) ────────────────────────────────────────────────────

/**
 * An OHLCV aggregate bar for an option contract over a fixed time window.
 * Used for dailyBar, minuteBar, prevDailyBar, and the /bars endpoint.
 */
export type AlpacaBar = {
    t: string  // Timestamp    — start of the bar period (RFC-3339)
    o: number  // Open         — first traded price in the period
    h: number  // High         — highest traded price in the period
    l: number  // Low          — lowest traded price in the period
    c: number  // Close        — last traded price in the period
    v: number  // Volume       — total contracts traded during the period
    n: number  // Trade count  — number of individual trades included in the bar
    vw: number  // VWAP         — volume-weighted average price for the period
}

// ─── Greeks ──────────────────────────────────────────────────────────────────

/**
 * Option Greeks — partial derivatives measuring the sensitivity of an option's
 * price to changes in model parameters.
 *
 * Greeks are only present when Alpaca can calculate them (requires a valid
 * implied-volatility model). Deep ITM/OTM or illiquid contracts may lack them.
 */
export type AlpacaGreeks = {
    delta: number  // Δ Delta — ∂Price/∂Spot; rate of change of option price w.r.t. underlying price.
    //           Calls: 0 → +1 (0.5 ≈ ATM).  Puts: −1 → 0 (−0.5 ≈ ATM).
    gamma: number  // Γ Gamma — ∂Delta/∂Spot; rate of change of delta w.r.t. underlying price.
    //           Always positive for long options; highest near ATM.
    theta: number  // Θ Theta — ∂Price/∂Time (per day); time decay of the option value.
    //           Always negative for long options (option loses value each day).
    vega: number  // V Vega  — ∂Price/∂σ; sensitivity to a 1-percentage-point change in implied volatility.
    //           Always positive for long options; highest near ATM.
    rho: number  // ρ Rho   — ∂Price/∂r; sensitivity to a 1-percentage-point change in the risk-free rate.
    //           Positive for calls (benefit from higher rates), negative for puts.
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/**
 * Full snapshot for a single option contract, as returned by:
 *   GET /v1beta1/options/snapshots/{underlying_symbol}
 *
 * Not all fields are always present — depends on the contract's liquidity and
 * whether it has traded recently. Greeks and impliedVolatility are absent for
 * deep ITM/OTM or illiquid contracts.
 */
export type AlpacaOptionSnapshot = {
    latestQuote?: AlpacaOptionQuote  // Latest NBBO quote (bid/ask)
    latestTrade?: AlpacaOptionTrade  // Most recent executed trade
    dailyBar?: AlpacaBar          // Current trading day OHLCV aggregate
    minuteBar?: AlpacaBar          // Most recent completed 1-minute bar
    prevDailyBar?: AlpacaBar          // Previous trading day OHLCV aggregate
    greeks?: AlpacaGreeks       // Option Greeks (Δ, Γ, Θ, V, ρ)
    impliedVolatility?: number            // IV — annualised implied volatility as a decimal (e.g. 0.45 = 45% IV)
}

// ─── Response envelopes ───────────────────────────────────────────────────────

/**
 * Response envelope for GET /v1beta1/options/snapshots/{underlying_symbol}
 */
export type AlpacaSnapshotsResponse = {
    /** Map of OCC contract symbol → snapshot. Key format: e.g. "NVDA260323C00175000" */
    snapshots: Record<string, AlpacaOptionSnapshot>
    /** Opaque cursor for the next page of results; null when all pages are exhausted */
    next_page_token: string | null
}

/**
 * Response envelope for GET /v1beta1/options/bars
 */
export type AlpacaBarsResponse = {
    /** Map of OCC contract symbol → chronological array of OHLCV bars */
    bars: Record<string, AlpacaBar[]>
    /** Opaque cursor for the next page; null when no more data */
    next_page_token: string | null
    /** Currency of all price values — typically "USD" */
    currency?: string
}
