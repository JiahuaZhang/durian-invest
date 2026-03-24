/**
 * Alpaca Markets HTTP client — shared base URL and authentication headers.
 *
 * Authentication: API key pair sent as custom HTTP headers on every request.
 * Docs: https://docs.alpaca.markets/docs/authentication
 *
 * Two distinct base URLs:
 *   DATA_BASE    — market data (quotes, bars, snapshots, trades)
 *   TRADING_BASE — account / order management (paper or live)
 *
 * Keys are read from VITE_* env vars (accessible server-side via process.env).
 */

/** Market data API — options snapshots, bars, trades, quotes */
export const ALPACA_DATA_BASE = 'https://data.alpaca.markets'

/** Trading API — account info, orders (paper trading) */
export const ALPACA_TRADING_BASE = 'https://paper-api.alpaca.markets'

/**
 * Build Alpaca authentication headers.
 * Must be called at request-time (not module load) so env vars are resolved.
 *
 * Header reference:
 *   APCA-API-KEY-ID     — public API key identifier
 *   APCA-API-SECRET-KEY — secret key (treat like a password, never expose client-side)
 */
export function alpacaHeaders(): Record<string, string> {
    return {
        'APCA-API-KEY-ID':     process.env['VITE_ALPACA_API_KEY']    ?? '',
        'APCA-API-SECRET-KEY': process.env['VITE_ALPACA_SECRET_KEY'] ?? '',
        'Accept': 'application/json',
    }
}

/**
 * Thin wrapper around fetch that applies Alpaca auth headers and throws a
 * descriptive error on non-2xx responses.
 */
export async function alpacaFetch<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: alpacaHeaders() })
    if (!res.ok) {
        const body = await res.text()
        throw new Error(`Alpaca API error (${res.status}) ${new URL(url).pathname}: ${body.slice(0, 300)}`)
    }
    return res.json() as Promise<T>
}
