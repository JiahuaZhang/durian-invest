/**
 * OCC (Options Clearing Corporation) standard option symbology
 *
 * Format: {underlying}{YYMMDD}{C|P}{strike}
 *
 * ┌──────────────┬────────┬─────┬──────────┐
 * │ Underlying   │ Date   │ T   │ Strike   │
 * │ up to 6 chars│ YYMMDD │ C/P │ 8 digits │
 * └──────────────┴────────┴─────┴──────────┘
 *
 * Strike encoding:
 *   Strike price × 1000, zero-padded to 8 digits (no decimal point).
 *   $175.00  → 00175000
 *   $182.50  → 00182500
 *   $5800.00 → 05800000
 *
 * Examples:
 *   "AAPL241220C00300000"  →  AAPL  2024-12-20  call  $300.00
 *   "NVDA260323P00175000"  →  NVDA  2026-03-23  put   $175.00
 *   "NVDA260323C00182500"  →  NVDA  2026-03-23  call  $182.50
 *
 * Reference: https://en.wikipedia.org/wiki/Option_symbol#OSI_symbology
 */

export type ParsedOCC = {
    /** Ticker of the underlying security, e.g. "AAPL", "NVDA" */
    underlying: string
    /** Expiration date in YYYY-MM-DD format */
    expDate: string
    /** Option type */
    type: 'call' | 'put'
    /** Strike price in dollars, e.g. 175.0 or 182.5 */
    strike: number
}

/**
 * Parse an OCC option symbol into its components.
 * Returns null if the symbol does not match OCC format.
 */
export function parseOCC(symbol: string): ParsedOCC | null {
    // Underlying: 1–6 uppercase letters
    // Date: 6 digits (YYMMDD)
    // Type: C (call) or P (put)
    // Strike: 8 digits (strike × 1000, zero-padded)
    const m = symbol.match(/^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/)
    if (!m) return null

    const [, underlying, date, cp, strikeStr] = m
    return {
        underlying,
        expDate: `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`,
        type: cp === 'C' ? 'call' : 'put',
        strike: parseInt(strikeStr, 10) / 1000,
    }
}
