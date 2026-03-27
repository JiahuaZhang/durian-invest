import { createFileRoute } from '@tanstack/react-router'
import { Copy, Search } from 'lucide-react'
import { useState } from 'react'
import { fetchTTChain, fetchTTMarketData } from '../utils/tastytrade/chain'
import type { TTExpiry, TTFutureInfo, TTStrikeRow } from '../utils/tastytrade/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDate(d: string) {
    const [, m, day] = d.split('-')
    return `${MONTHS[parseInt(m) - 1]} ${parseInt(day)}`
}

function formatDateTime(iso: string) {
    if (!iso) return '--'
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
        + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
}

function fmt(n: number | undefined, decimals = 2): string {
    if (n == null || n === 0) return '--'
    return n.toFixed(decimals)
}

function fmtIV(iv: number | undefined): string {
    if (!iv) return '--'
    return (iv * 100).toFixed(1) + '%'
}

function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {/* ignore */ })
}

function parseOptionSymbol(symbol: string) {
    const parts = symbol.split(' ')
    if (parts.length < 3) return null
    const m = parts[2].match(/^(\d+)([CP])(\d+(?:\.\d+)?)$/)
    if (!m) return null
    return { underlying: parts[0], contract: parts[1], date: m[1], type: m[2] as 'C' | 'P', strike: m[3] }
}

// ── Route ──────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/option/tastytrade')({
    head: () => ({ meta: [{ title: 'Gold Options — tastytrade' }] }),
    component: TTOptionPage,
})

// ── Types ──────────────────────────────────────────────────────────────────────

type ChainData = {
    expirations: TTExpiry[]
    futures: TTFutureInfo[]
    symbol: string
    fetchedAt: string
}

// ── Main Page ──────────────────────────────────────────────────────────────────

function TTOptionPage() {
    const [inputSymbol, setInputSymbol] = useState('GC')
    const [chainData, setChainData] = useState<ChainData | null>(null)
    const [loading, setLoading] = useState(false)
    const [mdLoading, setMdLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null)
    const [hasMd, setHasMd] = useState(false)
    const [view, setView] = useState<'calendar' | 'chain'>('calendar')

    async function loadChain() {
        const sym = inputSymbol.trim().toUpperCase()
        if (!sym) return
        setLoading(true)
        setError(null)
        setChainData(null)
        setHasMd(false)
        setSelectedExpiry(null)
        try {
            const data = await fetchTTChain({ data: { symbol: sym } })
            setChainData(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
        }
    }

    async function loadMarketData(expiry: TTExpiry) {
        setMdLoading(true)
        const symbols = expiry.strikes.flatMap(s => [s.callSymbol, s.putSymbol])
        try {
            const mdMap = await fetchTTMarketData({ data: { symbols } })
            setHasMd(Object.keys(mdMap).length > 0)
            setChainData(prev => {
                if (!prev) return prev
                return {
                    ...prev,
                    expirations: prev.expirations.map(e =>
                        e.date === expiry.date && e.underlyingSymbol === expiry.underlyingSymbol
                            ? {
                                ...e,
                                strikes: e.strikes.map(s => ({
                                    ...s,
                                    call: mdMap[s.callSymbol] ?? null,
                                    put: mdMap[s.putSymbol] ?? null,
                                })),
                            }
                            : e,
                    ),
                }
            })
        } catch { /* graceful */ } finally {
            setMdLoading(false)
        }
    }

    function openChain(expiry: TTExpiry) {
        setSelectedExpiry(expiry.date + '|' + expiry.underlyingSymbol)
        setView('chain')
        if (!expiry.strikes.some(s => s.call !== null)) {
            loadMarketData(expiry)
        }
    }

    const selectedExpiryObj = selectedExpiry
        ? chainData?.expirations.find(e => e.date + '|' + e.underlyingSymbol === selectedExpiry) ?? null
        : null

    return (
        <div un-flex="~ col" un-h="full">
            {/* ── Header ── */}
            <div un-flex="~ items-center gap-3 wrap" un-p="x-3 y-2" un-border="b slate-200">
                <div un-flex="~ items-center gap-2">
                    <h1 un-text="lg slate-800" un-font="bold">Futures Options</h1>
                    <span un-text="xs slate-500 bg-slate-100" un-p="x-1.5 y-0.5" un-rounded="md">tastytrade</span>
                </div>

                <div un-flex="~ items-center gap-1" un-ml="auto">
                    <input
                        type="text"
                        value={inputSymbol}
                        onChange={e => setInputSymbol(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && loadChain()}
                        placeholder="GC"
                        un-border="~ slate-300 rounded-lg" un-p="x-3 y-1.5" un-text="sm" un-w="18"
                        un-outline="focus:blue-400" un-font="mono"
                    />
                    <button
                        onClick={loadChain}
                        disabled={loading}
                        un-flex="~ items-center gap-1.5" un-p="x-3 y-1.5" un-text="sm white"
                        un-bg="blue-600 hover:blue-700 disabled:blue-300"
                        un-border="rounded-lg" un-cursor="pointer" un-transition="colors"
                    >
                        <Search size={13} />
                        {loading ? 'Loading…' : 'Load'}
                    </button>
                    {chainData && (
                        <span un-text="xs slate-400">
                            {chainData.expirations.length} expiries · fetched {chainData.fetchedAt.slice(11, 19)} UTC
                        </span>
                    )}
                </div>
            </div>

            {/* ── Error ── */}
            {error && (
                <div un-p="3 x-4" un-bg="red-50" un-text="red-700 sm" un-border="b red-200">
                    {error}
                </div>
            )}

            {/* ── Empty / loading ── */}
            {!chainData && !loading && !error && (
                <div un-flex="~ col items-center justify-center 1" un-text="slate-400 sm" un-gap="3">
                    <Search size={40} un-opacity="20" />
                    <p>Enter a futures symbol (GC = Gold, SI = Silver, CL = Crude) and click Load</p>
                </div>
            )}

            {loading && (
                <div un-flex="~ col items-center justify-center 1" un-gap="3">
                    <div un-w="10" un-h="10" un-border="4 blue-500 t-transparent rounded-full" un-animate="spin" />
                    <p un-text="slate-500 sm">Fetching chain from tastytrade…</p>
                </div>
            )}

            {chainData && !loading && (
                <div un-flex="~ col 1" un-overflow="hidden">
                    {/* ── Futures Strip ── */}
                    <FuturesStrip futures={chainData.futures} />

                    {/* ── View toggle ── */}
                    <div un-flex="~ items-center gap-2" un-p="x-3 y-1.5" un-border="b slate-200" un-bg="slate-50/30">
                        <div un-flex="~ gap-1">
                            {(['calendar', 'chain'] as const).map(v => (
                                <button key={v}
                                    onClick={() => setView(v)}
                                    disabled={v === 'chain' && !selectedExpiryObj}
                                    un-p="x-3 y-1" un-text="xs" un-cursor="pointer disabled:cursor-not-allowed"
                                    un-border="~ rounded-md"
                                    un-bg={view === v ? 'blue-600' : 'white hover:slate-50'}
                                    un-text-color={view === v ? 'white' : 'slate-500'}
                                    un-border-color={view === v ? 'blue-600' : 'slate-200'}
                                    un-opacity={v === 'chain' && !selectedExpiryObj ? '40' : '100'}
                                    un-transition="all"
                                >
                                    {v === 'calendar' ? 'Expiry Calendar' : 'Chain Table'}
                                </button>
                            ))}
                        </div>
                        {selectedExpiryObj && (
                            <span un-text="xs slate-400">
                                Selected: <span un-font="mono" un-text="slate-600">{selectedExpiryObj.underlyingSymbol} </span>
                                expiring {formatDate(selectedExpiryObj.date)} ({selectedExpiryObj.dte}d)
                            </span>
                        )}
                        <div un-ml="auto" un-text="xs slate-400">
                            {hasMd
                                ? <span un-text="emerald-600">● Live market data</span>
                                : <span>Structural data only — market data requires funded account</span>
                            }
                        </div>
                    </div>

                    {view === 'calendar' && (
                        <ExpiryCalendar
                            expirations={chainData.expirations}
                            selectedKey={selectedExpiry}
                            onSelect={openChain}
                        />
                    )}

                    {view === 'chain' && selectedExpiryObj && (
                        <div un-flex="~ col 1" un-overflow="hidden">
                            {mdLoading && (
                                <div un-p="x-3 y-1.5" un-bg="blue-50" un-border="b blue-200" un-text="xs blue-600">
                                    Loading market data…
                                </div>
                            )}
                            {!hasMd && !mdLoading && (
                                <div un-p="x-3 y-1.5" un-bg="amber-50" un-border="b amber-200" un-text="xs amber-700">
                                    No market data — bid/ask/IV/Greeks require a funded tastytrade account. Option symbols are shown for reference.
                                </div>
                            )}
                            <ChainTable expiry={selectedExpiryObj} hasMd={hasMd} />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Futures Strip ──────────────────────────────────────────────────────────────

function FuturesStrip({ futures }: { futures: TTFutureInfo[] }) {
    if (!futures.length) return null
    return (
        <div un-flex="~  items-center gap-2" un-p="x-3 y-2" un-border="b slate-200" un-bg="slate-50/50" un-overflow="x-auto">
            <span un-text="xs slate-400" >Underlying futures</span>
            {futures.map(f => (
                <div key={f.symbol}
                    un-flex="~ col shrink-0" un-p="x-2.5 y-1.5"
                    un-border="~ slate-200 rounded-lg"
                    un-bg={f.isActiveMonth ? 'amber-50' : 'white'}
                    un-border-color={f.isActiveMonth ? 'amber-300' : f.isNextActiveMonth ? 'blue-200' : 'slate-200'}
                >
                    <div un-flex="~ items-center gap-1.5">
                        <span un-font="mono semibold" un-text="sm slate-800">{f.symbol}</span>
                        {f.isActiveMonth && (
                            <span un-text="2xs amber-700 bg-amber-100" un-p="x-1 y-0.5" un-rounded="sm">ACTIVE</span>
                        )}
                        {f.isNextActiveMonth && !f.isActiveMonth && (
                            <span un-text="2xs blue-600 bg-blue-50" un-p="x-1 y-0.5" un-rounded="sm">NEXT</span>
                        )}
                    </div>
                    <span un-text="xs slate-500">Exp {formatDate(f.expirationDate)}</span>
                    <span un-text="2xs slate-400">{f.dte}d · stops {formatDateTime(f.stopsTradingAt)}</span>
                </div>
            ))}
        </div>
    )
}

// ── Expiry Calendar ────────────────────────────────────────────────────────────

function ExpiryCalendar({
    expirations, selectedKey, onSelect,
}: {
    expirations: TTExpiry[]
    selectedKey: string | null
    onSelect: (e: TTExpiry) => void
}) {
    return (
        <div un-flex="~ col 1" un-overflow="auto">
            <table un-w="full" un-text="xs" un-border-collapse="collapse">
                <thead un-bg="slate-50" un-position="sticky" un-top="0" un-z="10">
                    <tr>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">Date</th>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">DTE</th>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">Type</th>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">Settlement</th>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">Exercise</th>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">Underlying</th>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">Contract</th>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">Option Root</th>
                        <th un-p="x-3 y-2" un-text="right slate-500" un-border="b slate-200">Strikes</th>
                        <th un-p="x-3 y-2" un-text="left slate-500" un-border="b slate-200">Action</th>
                    </tr>
                </thead>
                <tbody>
                    {expirations.map(e => {
                        const key = e.date + '|' + e.underlyingSymbol
                        const isSelected = selectedKey === key
                        const isWeekly = e.expiryType === 'Weekly'
                        const isExpiring = e.dte <= 3
                        return (
                            <tr key={key}
                                un-border="b slate-100"
                                un-bg={isSelected ? 'blue-50' : 'hover:slate-50'}
                                un-transition="colors"
                                un-cursor="pointer"
                                onClick={() => onSelect(e)}
                            >
                                <td un-p="x-3 y-2" un-font="mono semibold" un-text="slate-700">
                                    {e.date}
                                </td>
                                <td un-p="x-3 y-2">
                                    <span un-font={isExpiring ? 'mono semibold' : 'mono'}
                                        un-text={isExpiring ? 'red-600' : e.dte <= 14 ? 'amber-600' : 'slate-600'}
                                    >
                                        {e.dte}d
                                    </span>
                                </td>
                                <td un-p="x-3 y-2">
                                    <span
                                        un-p="x-1.5 y-0.5" un-rounded="sm" un-text="2xs"
                                        un-bg={isWeekly ? 'blue-50' : 'slate-100'}
                                        un-text-color={isWeekly ? 'blue-600' : 'slate-500'}
                                        un-border={isWeekly ? '~ blue-200' : '~ slate-200'}
                                    >
                                        {e.expiryType}
                                    </span>
                                </td>
                                <td un-p="x-3 y-2" un-text="slate-600">
                                    {e.settlementType}
                                </td>
                                <td un-p="x-3 y-2" un-text="slate-600">
                                    {e.exerciseStyle}
                                </td>
                                <td un-p="x-3 y-2" un-font="mono" un-text="slate-700">
                                    {e.underlyingSymbol}
                                </td>
                                <td un-p="x-3 y-2" un-font="mono" un-text="slate-600">
                                    {e.contractSymbol}
                                </td>
                                <td un-p="x-3 y-2" un-font="mono" un-text="slate-600">
                                    {e.optionRootSymbol}
                                </td>
                                <td un-p="x-3 y-2" un-text="right slate-500">
                                    {e.strikes.length}
                                </td>
                                <td un-p="x-3 y-2">
                                    <button
                                        onClick={ev => { ev.stopPropagation(); onSelect(e) }}
                                        un-p="x-2 y-0.5" un-text="2xs" un-cursor="pointer"
                                        un-border="~ rounded"
                                        un-bg={isSelected ? 'blue-600' : 'slate-100 hover:blue-50'}
                                        un-text-color={isSelected ? 'white' : 'slate-500 hover:blue-600'}
                                        un-border-color={isSelected ? 'blue-600' : 'slate-200 hover:blue-300'}
                                        un-transition="all"
                                    >
                                        {isSelected ? 'Viewing' : 'View Chain'}
                                    </button>
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

// ── Chain Table ────────────────────────────────────────────────────────────────

function ChainTable({ expiry, hasMd }: { expiry: TTExpiry; hasMd: boolean }) {
    return (
        <div un-flex="~ col 1" un-overflow="hidden">
            {/* Sub-header */}
            <div un-flex="~ items-center gap-4 wrap" un-p="x-3 y-1.5" un-border="b slate-200" un-bg="slate-50/30" un-text="xs">
                <span un-text="slate-500">{expiry.strikes.length} strikes</span>
                <span>
                    <span un-text="slate-400">Underlying: </span>
                    <span un-font="mono" un-text="slate-700">{expiry.underlyingSymbol}</span>
                </span>
                <span>
                    <span un-text="slate-400">Contract: </span>
                    <span un-font="mono" un-text="slate-600">{expiry.contractSymbol}</span>
                </span>
                <span>
                    <span un-text="slate-400">Root: </span>
                    <span un-font="mono" un-text="slate-600">{expiry.optionRootSymbol}</span>
                </span>
                <span>
                    <span un-text="slate-400">Settlement: </span>
                    <span un-text="slate-600">{expiry.settlementType}</span>
                </span>
                <span>
                    <span un-text="slate-400">Exercise: </span>
                    <span un-text="slate-600">{expiry.exerciseStyle}</span>
                </span>
            </div>

            <div un-overflow="auto">
                <table un-w="full" un-text="xs" un-border-collapse="collapse">
                    <thead un-bg="slate-50" un-position="sticky" un-top="0" un-z="10">
                        <tr>
                            <th un-p="x-2 y-2" un-border="b r slate-200"
                                un-text={hasMd ? 'left emerald-600' : 'right emerald-600'}
                                colSpan={hasMd ? 5 : 1}>
                                CALL
                            </th>
                            <th un-p="x-3 y-2" un-text="center slate-700" un-bg="slate-100" un-border="b slate-200">
                                Strike
                            </th>
                            <th un-p="x-2 y-2" un-text="left red-500" un-border="b l slate-200" colSpan={hasMd ? 5 : 1}>
                                PUT
                            </th>
                        </tr>
                        {hasMd && (
                            <tr>
                                <th un-p="x-2 y-1.5" un-text="left slate-400" un-border="b slate-100">Symbol</th>
                                <th un-p="x-2 y-1.5" un-text="right slate-400" un-border="b slate-100">IV</th>
                                <th un-p="x-2 y-1.5" un-text="right slate-400" un-border="b slate-100">Δ</th>
                                <th un-p="x-2 y-1.5" un-text="right slate-400" un-border="b slate-100">Bid</th>
                                <th un-p="x-2 y-1.5" un-text="right slate-400" un-border="b r slate-200">Ask</th>
                                <th un-p="x-3 y-1.5" un-bg="slate-100" un-border="b slate-200" />
                                <th un-p="x-2 y-1.5" un-text="left slate-400" un-border="b l slate-200">Bid</th>
                                <th un-p="x-2 y-1.5" un-text="right slate-400" un-border="b slate-100">Ask</th>
                                <th un-p="x-2 y-1.5" un-text="right slate-400" un-border="b slate-100">Δ</th>
                                <th un-p="x-2 y-1.5" un-text="right slate-400" un-border="b slate-100">IV</th>
                                <th un-p="x-2 y-1.5" un-text="left slate-400" un-border="b l slate-200">Symbol</th>
                            </tr>
                        )}
                    </thead>
                    <tbody>
                        {expiry.strikes.map(row => (
                            <StrikeRow key={row.strike} row={row} hasMd={hasMd} />
                        ))}
                    </tbody>
                </table>
                {expiry.strikes.length === 0 && (
                    <div un-p="8" un-text="center slate-400">No strikes available for this expiration.</div>
                )}
            </div>
        </div>
    )
}

function StrikeRow({ row, hasMd }: { row: TTStrikeRow; hasMd: boolean }) {
    const { strike, callSymbol, putSymbol } = row
    const strikeStr = strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(1)

    if (!hasMd) {
        return (
            <tr un-border="b slate-100" un-transition="colors" un-bg="hover:slate-50/60">
                <td un-p="x-2 y-1.5" un-border="r slate-200">
                    <SymbolCell symbol={callSymbol} align="right" />
                </td>
                <td un-p="x-3 y-1.5" un-text="center slate-700" un-font='mono bold' un-bg="slate-50"
                    un-border="r slate-200">
                    {strikeStr}
                </td>
                <td un-p="x-2 y-1.5">
                    <SymbolCell symbol={putSymbol} />
                </td>
            </tr>
        )
    }

    const { call, put } = row
    const callDelta = call?.delta
    const putDelta = put?.delta
    const isCallITM = callDelta != null && Math.abs(callDelta) > 0.5
    const isPutITM = putDelta != null && Math.abs(putDelta) > 0.5
    const callBg = isCallITM ? 'emerald-50' : ''
    const putBg = isPutITM ? 'red-50' : ''

    return (
        <tr un-border="b slate-100" un-transition="colors" un-bg="hover:slate-50/60">
            <td un-p="x-2 y-1.5" un-bg={callBg}>
                <SymbolCell symbol={callSymbol} />
            </td>
            <td un-p="x-2 y-1.5" un-text="right slate-500" un-bg={callBg}>{fmtIV(call?.['implied-volatility'])}</td>
            <td un-p="x-2 y-1.5" un-text="right emerald-600 font-mono" un-bg={callBg}>{fmt(call?.delta, 3)}</td>
            <td un-p="x-2 y-1.5" un-text="right emerald-600 font-mono semibold" un-bg={callBg}>{fmt(call?.bid)}</td>
            <td un-p="x-2 y-1.5" un-text="right red-500 font-mono semibold" un-border="r slate-200" un-bg={callBg}>{fmt(call?.ask)}</td>
            <td un-p="x-3 y-1.5" un-text="center font-mono semibold slate-700" un-bg="slate-50"
                un-border="r slate-200">
                {strikeStr}
            </td>
            <td un-p="x-2 y-1.5" un-text="emerald-600 font-mono semibold" un-bg={putBg}>{fmt(put?.bid)}</td>
            <td un-p="x-2 y-1.5" un-text="right red-500 font-mono semibold" un-bg={putBg}>{fmt(put?.ask)}</td>
            <td un-p="x-2 y-1.5" un-text="right red-500 font-mono" un-bg={putBg}>{fmt(put?.delta, 3)}</td>
            <td un-p="x-2 y-1.5" un-text="right slate-500" un-bg={putBg}>{fmtIV(put?.['implied-volatility'])}</td>
            <td un-p="x-2 y-1.5" un-bg={putBg}>
                <SymbolCell symbol={putSymbol} />
            </td>
        </tr>
    )
}

function SymbolCell({ symbol, align = 'left' }: { symbol: string; align?: 'left' | 'right' }) {
    const parsed = parseOptionSymbol(symbol)
    const isRight = align === 'right'

    const copyBtn = (
        <button
            onClick={() => copyText(symbol)}
            un-opacity="0 group-hover:100" un-transition="opacity"
            un-cursor="pointer" un-p="0.5" un-rounded="sm"
            un-text="slate-400 hover:slate-700"
            title="Copy symbol"
        >
            <Copy size={10} />
        </button>
    )

    const symbolContent = parsed ? (
        <span un-flex="~ gap-0.5">
            <span un-font="mono" un-text="2xs slate-400">{parsed.underlying}</span>
            <span un-text="2xs slate-300">·</span>
            <span un-font="mono" un-text="2xs slate-500">{parsed.contract}</span>
            <span un-text="2xs slate-300">·</span>
            <span un-font="mono" un-text="2xs slate-400">{parsed.date}</span>
            <span un-font="mono semibold" un-text={parsed.type === 'C' ? '2xs emerald-600' : '2xs red-500'}>{parsed.type}</span>
            <span un-font="mono semibold" un-text="sm slate-800">{parsed.strike}</span>
        </span>
    ) : (
        <span un-font="mono" un-text="2xs slate-500">{symbol}</span>
    )

    return (
        <div un-flex={isRight ? '~ items-center gap-1.5 group justify-end' : '~ items-center gap-1.5 group'}>
            {isRight ? copyBtn : symbolContent}
            {isRight ? symbolContent : copyBtn}
        </div>
    )
}

// UnoCSS safelist
export const _UnoSafelist = (
    <div
        un-bg="blue-50 blue-100 amber-50 amber-100 emerald-50 red-50 slate-50 slate-100 white"
        un-text-color="white blue-600 amber-600 amber-700 emerald-600 red-500 red-600 slate-300 slate-400 slate-500 slate-600 slate-700 slate-800"
        un-border-color="blue-200 blue-300 blue-600 amber-200 amber-300 slate-100 slate-200 red-200 emerald-200"
    />
)
