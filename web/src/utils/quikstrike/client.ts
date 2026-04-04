import type { QSProductInfo, QSLeg, QSStrikeRow } from './types'

export const QS_BASE = 'https://cmegroup-sso.quikstrike.net'
export const QS_BATCH_ENDPOINT = '/AjaxPages/QuikScript.aspx/BatchLoadCommand'

// ── Known CME products ────────────────────────────────────────────────────────

export const QS_PRODUCTS: QSProductInfo[] = [
    { label: 'Gold (OG|GC)', optRoot: 'OG', futRoot: 'GC', pf: 6, pid: 40 },
    { label: 'Silver (SO|SI)', optRoot: 'SO', futRoot: 'SI', pf: 6, pid: 40 },
    { label: 'Copper (HXE|HG)', optRoot: 'HXE', futRoot: 'HG', pf: 6, pid: 40 },
    { label: 'Crude Oil (LO|CL)', optRoot: 'LO', futRoot: 'CL', pf: 3, pid: 40 },
    { label: 'Natural Gas (ON|NG)', optRoot: 'ON', futRoot: 'NG', pf: 3, pid: 40 },
    { label: 'S&P 500 (ES|ES)', optRoot: 'ES', futRoot: 'ES', pf: 13, pid: 40 },
    { label: 'Nasdaq 100 (NQ|NQ)', optRoot: 'NQ', futRoot: 'NQ', pf: 13, pid: 40 },
    { label: 'Eurodollar (GE|GE)', optRoot: 'GE', futRoot: 'GE', pf: 1, pid: 40 },
    { label: 'T-Note 10Y (OZN|ZN)', optRoot: 'OZN', futRoot: 'ZN', pf: 1, pid: 40 },
    { label: 'SOFR (SR3|SR3)', optRoot: 'SR3', futRoot: 'SR3', pf: 1, pid: 40 },
]

// ── BatchLoadCommand request types ──────────────────────────────────────────

export type QSCommandArg = {
    Command: {
        CommandText: string
        CommandId: number
        Type: number      // 5 = header, 0 = data request
        EntityType: number // 4 = standard
        Batch: string
        Qty: number
        PreText: null
        OrigPrem: null
        ColumnDefs: null
    }
    IsNew: false
    IsReadOnly: true
    Fields: string[]
    CommandParameters: null
    SpreadSessionId: null
}

function makeCommand(text: string, fields: string[], type = 0): QSCommandArg {
    return {
        Command: {
            CommandText: text, CommandId: -1, Type: type,
            EntityType: 4, Batch: '', Qty: 1,
            PreText: null, OrigPrem: null, ColumnDefs: null,
        },
        IsNew: false, IsReadOnly: true,
        Fields: fields, CommandParameters: null, SpreadSessionId: null,
    }
}

// ── Build BatchLoadCommand args ─────────────────────────────────────────────

const OPT_FIELDS = ['tv', 'vol', 'delta', 'oi']

/** Build args to fetch an option chain centered on ATM with N strikes each side. */
export function buildOptionChainArgs(optionSeries: string, numStrikes = 12): QSCommandArg[] {
    const args: QSCommandArg[] = [makeCommand('header', OPT_FIELDS, 5)]
    for (let i = numStrikes; i >= 1; i--)
        args.push(makeCommand(`${optionSeries} X-${i} P`, OPT_FIELDS))
    args.push(makeCommand(`${optionSeries} X S`, OPT_FIELDS))
    for (let i = 1; i <= numStrikes; i++)
        args.push(makeCommand(`${optionSeries} X+${i} C`, OPT_FIELDS))
    return args
}

// ── Execute BatchLoadCommand ────────────────────────────────────────────────

export async function qsBatchLoad(
    cookies: string,
    args: QSCommandArg[],
    pf = 6,
    pid = 40,
): Promise<{ status: number; data: unknown; body: string }> {
    // Use node:https directly because Node.js fetch (undici) silently strips
    // the Cookie header per the Fetch spec's "forbidden header" rules.
    const https = await import('node:https')
    const url = new URL(`${QS_BASE}${QS_BATCH_ENDPOINT}`)
    const payload = JSON.stringify({ args })

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cookie': cookies,
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': `${QS_BASE}/User/QuikStrikeView.aspx?pid=${pid}&pf=${pf}`,
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Content-Length': Buffer.byteLength(payload),
                },
            },
            (res) => {
                const chunks: Buffer[] = []
                res.on('data', (chunk: Buffer) => chunks.push(chunk))
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8')
                    let data: unknown = null
                    try { data = JSON.parse(text) } catch { /* not JSON */ }
                    resolve({ status: res.statusCode ?? 0, data, body: text })
                })
            },
        )
        req.on('error', reject)
        req.write(payload)
        req.end()
    })
}

// ── Parse BatchLoadCommand response ─────────────────────────────────────────

export function parseBatchResponse(data: unknown): {
    legs: QSLeg[]
    futuresPrice: number
    futuresChange: number
    futuresSymbol: string
    dte: number
    atmIV: number
    errorMessage?: string
} {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (data as any)?.d ?? []
    const legs: QSLeg[] = []
    let futuresPrice = 0, futuresChange = 0, futuresSymbol = '', dte = 0, atmIV = 0

    // Check for auth errors (QuikStrike returns 200 with ErrorMessage for session issues)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of items as any[]) {
        const errMsg = item?.SpreadItem?.ErrorMessage
        if (errMsg && typeof errMsg === 'string' && errMsg.length > 0) {
            return { legs: [], futuresPrice: 0, futuresChange: 0, futuresSymbol: '', dte: 0, atmIV: 0, errorMessage: errMsg }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of items as any[]) {
        const si = item?.SpreadItem
        if (!si?.Spread) continue
        const spread = si.Spread
        const cmd: string = si.Command?.CommandText ?? ''
        const isStraddle: boolean = spread.IsStraddle ?? false
        const oi: number = spread.Values?.OI ?? 0
        const volume: number = spread.Values?.Volume ?? 0

        // Extract futures metadata from spread-level fields
        if (futuresPrice === 0 && spread.Future) {
            futuresPrice = parseFloat(spread.Future) || 0
            futuresChange = parseFloat(spread.FutureChg) || 0
            futuresSymbol = spread.FSymbol ?? ''
        }
        if (dte === 0 && spread.DTE) {
            dte = parseFloat(spread.DTE) || 0
        }

        const positions = spread.Positions ?? []
        for (const pos of positions) {
            for (const leg of pos.Legs ?? []) {
                const v = leg.Values
                if (!v) continue

                if (isStraddle && atmIV === 0) {
                    atmIV = v.Vol * 100
                }

                const type: 'C' | 'P' = v.Type === 0 ? 'C' : 'P'
                legs.push({
                    symbol: cmd,
                    strike: v.Strike,
                    type,
                    prem: v.UnitTV,
                    vol: v.Vol * 100,
                    delta: v.UnitDelta,
                    oi,
                    volume,
                    gamma: v.UnitGamma,
                    theta: v.UnitTheta,
                    vega: v.UnitVega,
                })
            }
        }
    }

    return { legs, futuresPrice, futuresChange, futuresSymbol, dte, atmIV }
}

// ── Build strike rows from legs ─────────────────────────────────────────────

export function buildStrikeRows(legs: QSLeg[]): QSStrikeRow[] {
    const map = new Map<number, QSStrikeRow>()
    for (const leg of legs) {
        if (!map.has(leg.strike)) {
            map.set(leg.strike, { strike: leg.strike, call: null, put: null })
        }
        const row = map.get(leg.strike)!
        if (leg.type === 'C') row.call = leg
        else if (leg.type === 'P') row.put = leg
    }
    return Array.from(map.values()).sort((a, b) => a.strike - b.strike)
}
