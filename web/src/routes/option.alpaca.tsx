import { createFileRoute } from '@tanstack/react-router'
import { CandlestickSeries, createChart, HistogramSeries } from 'lightweight-charts'
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
    fetchOptionBars,
    fetchOptionChain,
    type OptionBar,
    type OptionSnapshot,
} from '../utils/alpaca/options'

// ── Helpers ────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatExpiry(d: string) {
    const [, m, day] = d.split('-')
    return `${MONTHS[parseInt(m) - 1]} ${parseInt(day)}`
}

function formatExpiryFull(d: string) {
    const [y, m, day] = d.split('-')
    return `${MONTHS[parseInt(m) - 1]} ${parseInt(day)} ${y}`
}

function fmt(n: number, decimals = 2): string {
    if (n === 0) return '--'
    return n.toFixed(decimals)
}

function fmtK(n: number): string {
    if (!n) return '--'
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return n.toString()
}

function fmtIV(iv: number): string {
    if (!iv) return '--'
    return (iv * 100).toFixed(1) + '%'
}

const TIMEFRAMES = [
    { value: '1Day', label: 'D', startDays: 180 },
    { value: '1Hour', label: 'H', startDays: 30 },
    { value: '5Min', label: '5m', startDays: 7 },
    { value: '1Min', label: '1m', startDays: 2 },
] as const
type TF = typeof TIMEFRAMES[number]['value']

function barStartDate(startDays: number) {
    const d = new Date()
    d.setDate(d.getDate() - startDays)
    return d.toISOString().slice(0, 10)
}

// ── Route ──────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/option/alpaca')({
    head: () => ({ meta: [{ title: 'Option Chain — Alpaca' }] }),
    component: AlpacaOptionPage,
})

// ── Types ──────────────────────────────────────────────────────────────────────

type ChainData = {
    options: OptionSnapshot[]
    underlyingPrice: number
    fetchedAt: string
}

type StrikeRow = {
    strike: number
    call: OptionSnapshot | null
    put: OptionSnapshot | null
}

// ── Main Page ──────────────────────────────────────────────────────────────────

function AlpacaOptionPage() {
    const [inputSymbol, setInputSymbol] = useState('NVDA')
    const [chainData, setChainData] = useState<ChainData | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedExpiry, setSelectedExpiry] = useState<string | null>(null)
    const [selectedOption, setSelectedOption] = useState<OptionSnapshot | null>(null)
    const [typeFilter, setTypeFilter] = useState<'all' | 'call' | 'put'>('all')

    async function loadChain() {
        const sym = inputSymbol.trim().toUpperCase()
        if (!sym) return
        setLoading(true)
        setError(null)
        setSelectedOption(null)
        setSelectedExpiry(null)
        try {
            const data = await fetchOptionChain({ data: { symbol: sym } })
            setChainData(data)
            const expiries = [...new Set(data.options.map(o => o.expirationDate))].sort()
            // auto-select nearest expiry
            setSelectedExpiry(expiries[0] ?? null)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
        }
    }

    const expiries = chainData
        ? [...new Set(chainData.options.map(o => o.expirationDate))].sort()
        : []

    const strikeRows: StrikeRow[] = (() => {
        if (!chainData || !selectedExpiry) return []
        const map = new Map<number, StrikeRow>()
        for (const opt of chainData.options) {
            if (opt.expirationDate !== selectedExpiry) continue
            if (!map.has(opt.strikePrice)) map.set(opt.strikePrice, { strike: opt.strikePrice, call: null, put: null })
            const row = map.get(opt.strikePrice)!
            if (opt.optionType === 'call') row.call = opt
            else row.put = opt
        }
        return [...map.values()].sort((a, b) => a.strike - b.strike)
    })()

    const hasChart = selectedOption !== null

    return (
        <div un-flex="~ col" un-h="full" >
            {/* ── Header ── */}
            <div un-flex="~ items-center gap-3 wrap" un-p="x-3 y-2" un-border="b slate-200">
                <div un-flex="~ items-center gap-2">
                    <h1 un-text="lg" un-font="bold" un-text-color="slate-800">Option Chain</h1>
                    <span un-text="xs slate-400 bg-slate-100" un-p="x-1.5 y-0.5">Alpaca</span>
                </div>

                {chainData && chainData.underlyingPrice > 0 && (
                    <div un-flex="~ items-center gap-2" un-text="sm">
                        <span un-font="bold mono" un-text="xl slate-800">
                            ${chainData.underlyingPrice.toFixed(2)}
                        </span>
                        <span un-text="xs slate-400">
                            {chainData.options[0]?.underlying ?? inputSymbol.toUpperCase()}
                        </span>
                    </div>
                )}

                <div un-flex="~ items-center gap-1" un-ml="auto">
                    <input
                        type="text"
                        value={inputSymbol}
                        onChange={e => setInputSymbol(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && loadChain()}
                        placeholder="NVDA"
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
                        <span un-text="xs slate-400 ml-2">
                            {chainData.options.length} contracts · {chainData.fetchedAt.slice(11, 19)} UTC
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

            {/* ── Expiry tabs ── */}
            {expiries.length > 0 && (
                <div un-flex="~ items-center gap-1" un-p="x-3 y-1.5" un-border="b slate-200"
                    un-overflow="x-auto" un-bg="slate-50/50">
                    <span un-text="xs slate-400">Expiry: </span>
                    {expiries.map(d => (
                        <button key={d}
                            onClick={() => { setSelectedExpiry(d); setSelectedOption(null) }}
                            un-p="x-2.5 y-1" un-text="xs" un-cursor="pointer" un-transition="all"
                            un-border="~ rounded-md"
                            un-bg={selectedExpiry === d ? 'blue-600' : 'white hover:slate-50'}
                            un-text-color={selectedExpiry === d ? 'white' : 'slate-600'}
                            un-border-color={selectedExpiry === d ? 'blue-600' : 'slate-200'}
                        >
                            {formatExpiry(d)}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Empty states ── */}
            {!chainData && !loading && (
                <div un-flex="~ col items-center justify-center 1" un-text="slate-400 sm" un-gap="3">
                    <Search size={40} un-opacity="20" />
                    <p>Enter a symbol and click Load to see the option chain</p>
                </div>
            )}

            {loading && (
                <div un-flex="~ col items-center justify-center 1" un-gap="3">
                    <div un-w="10" un-h="10" un-border="4 blue-500 t-transparent" un-rounded="full" un-animate="spin" />
                    <p un-text="slate-500 sm">Fetching option chain…</p>
                </div>
            )}

            {/* ── Main content ── */}
            {chainData && !loading && (
                <div un-flex="~" un-overflow="hidden" >
                    {/* Chain table — shrinks when chart is open */}
                    <div
                        un-flex={`~ col grow-1 ${hasChart ? '' : ''}`} un-transition="all" un-duration="300"
                        un-border-r={`${hasChart ? '1 slate-200' : 'none'}`}
                        un-border="2 solid blue-400"
                    // style={{ flex: hasChart ? '0 0 58%' : '1', borderRight: hasChart ? '1px solid #e2e8f0' : 'none' }}
                    >
                        <ChainTable
                            rows={strikeRows}
                            underlyingPrice={chainData.underlyingPrice}
                            selectedOption={selectedOption}
                            onSelectOption={opt => setSelectedOption(prev => prev?.symbol === opt.symbol ? null : opt)}
                            typeFilter={typeFilter}
                            onTypeFilterChange={setTypeFilter}
                        />
                    </div>

                    {/* Chart panel */}
                    {hasChart && selectedOption && (
                        <div un-flex="~ col grow-2"
                        // style={{ flex: '0 0 42%' }}
                        >
                            <OptionChartPanel
                                option={selectedOption}
                                onClose={() => setSelectedOption(null)}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Chain Table ────────────────────────────────────────────────────────────────

function ChainTable({
    rows, underlyingPrice, selectedOption, onSelectOption, typeFilter, onTypeFilterChange,
}: {
    rows: StrikeRow[]
    underlyingPrice: number
    selectedOption: OptionSnapshot | null
    onSelectOption: (o: OptionSnapshot) => void
    typeFilter: 'all' | 'call' | 'put'
    onTypeFilterChange: (t: 'all' | 'call' | 'put') => void
}) {
    const showCalls = typeFilter !== 'put'
    const showPuts = typeFilter !== 'call'

    return (
        <div un-flex="~ col" un-h="full">
            {/* Sub-header: type filter + legend */}
            <div un-flex="~ items-center gap-2" un-p="x-3 y-1" un-border="b slate-200" un-bg="slate-50/30">
                <div un-flex="~ gap-1">
                    {(['all', 'call', 'put'] as const).map(t => (
                        <button key={t}
                            onClick={() => onTypeFilterChange(t)}
                            un-p="x-2.5 y-0.5" un-text="xs" un-cursor="pointer" un-transition="all"
                            un-border="~ rounded-md"
                            un-bg={typeFilter === t
                                ? (t === 'call' ? 'emerald-500' : t === 'put' ? 'red-500' : 'blue-600')
                                : 'white hover:slate-50'}
                            un-text-color={typeFilter === t ? 'white' : 'slate-600'}
                            un-border-color={typeFilter === t
                                ? (t === 'call' ? 'emerald-500' : t === 'put' ? 'red-500' : 'blue-600')
                                : 'slate-200'}
                        >
                            {t === 'all' ? 'Both' : t === 'call' ? 'Calls' : 'Puts'}
                        </button>
                    ))}
                </div>
                <div un-flex="~ gap-3 items-center" un-ml="auto" un-text="xs slate-400">
                    <span un-flex="~ items-center gap-1">
                        <i un-w="2.5" un-h="2.5" un-rounded="sm" un-bg="emerald-200" /> ITM Call
                    </span>
                    <span un-flex="~ items-center gap-1">
                        <i un-w="2.5" un-h="2.5" un-rounded="sm" un-bg="red-200" /> ITM Put
                    </span>
                    <span un-flex="~ items-center gap-1">
                        <span un-text="amber-500">◆</span> ATM
                    </span>
                    <span un-text="slate-300">Click row to view chart</span>
                </div>
            </div>

            {/* Scrollable table */}
            <div un-overflow="auto">
                <table un-text="xs" un-w='full'>
                    <thead un-bg="slate-50" un-position="sticky" un-top="0" un-z="10">
                        <tr>
                            {showCalls && (
                                <>
                                    <th un-p="x-2 y-2" un-text="left slate-500" un-border="b slate-200">IV</th>
                                    <th un-p="x-2 y-2" un-text="right slate-500" un-border="b slate-200">Δ</th>
                                    <th un-p="x-2 y-2" un-text="right slate-500" un-border="b slate-200">Vol</th>
                                    <th un-p="x-2 y-2" un-text="right slate-500" un-border="b slate-200">Bid</th>
                                    <th un-p="x-2 y-2" un-text="right slate-500" un-border="b r-2 slate-200">Ask</th>
                                </>
                            )}
                            <th un-p="x-3 y-2" un-text="center slate-700" un-bg="slate-100" un-border="b slate-200">Strike</th>
                            {showPuts && (
                                <>
                                    <th un-p="x-2 y-2" un-text="left slate-500" un-border="b l-2 slate-200">Bid</th>
                                    <th un-p="x-2 y-2" un-text="right slate-500" un-border="b slate-200">Ask</th>
                                    <th un-p="x-2 y-2" un-text="right slate-500" un-border="b slate-200">Vol</th>
                                    <th un-p="x-2 y-2" un-text="right slate-500" un-border="b slate-200">Δ</th>
                                    <th un-p="x-2 y-2" un-text="right slate-500" un-border="b slate-200">IV</th>
                                </>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <ChainRow key={row.strike} row={row} underlyingPrice={underlyingPrice}
                                selectedOption={selectedOption} onSelectOption={onSelectOption}
                                showCalls={showCalls} showPuts={showPuts}
                            />
                        ))}
                    </tbody>
                </table>

                {rows.length === 0 && (
                    <div un-p="8" un-text="center slate-400">No contracts for this expiration.</div>
                )}
            </div>
        </div>
    )
}

function ChainRow({
    row, underlyingPrice, selectedOption, onSelectOption, showCalls, showPuts,
}: {
    row: StrikeRow
    underlyingPrice: number
    selectedOption: OptionSnapshot | null
    onSelectOption: (o: OptionSnapshot) => void
    showCalls: boolean
    showPuts: boolean
}) {
    const { strike, call, put } = row
    const isCallITM = underlyingPrice > 0 && strike < underlyingPrice
    const isPutITM = underlyingPrice > 0 && strike > underlyingPrice
    const isATM = underlyingPrice > 0 && Math.abs(strike - underlyingPrice) / underlyingPrice < 0.004

    const callSel = call && selectedOption?.symbol === call.symbol
    const putSel = put && selectedOption?.symbol === put.symbol

    const callBgVal = callSel ? 'blue-100' : isCallITM ? 'emerald-50' : 'hover:slate-50/80'
    const putBgVal = putSel ? 'blue-100' : isPutITM ? 'red-50' : 'hover:slate-50/80'

    return (
        <tr un-border="b slate-100" un-transition="colors">
            {/* ── Call side ── */}
            {showCalls && call ? (
                <>
                    <td un-bg={callBgVal} un-p="x-2 y-1.5" un-cursor="pointer" un-transition="colors"
                        onClick={() => call && onSelectOption(call)}>
                        <span un-text="slate-600">{fmtIV(call.impliedVolatility)}</span>
                    </td>
                    <td un-bg={callBgVal} un-p="x-2 y-1.5" un-text="right emerald-600" un-cursor="pointer"
                        onClick={() => call && onSelectOption(call)}>
                        {fmt(call.delta, 3)}
                    </td>
                    <td un-bg={callBgVal} un-p="x-2 y-1.5" un-text="right slate-600" un-cursor="pointer"
                        onClick={() => call && onSelectOption(call)}>
                        {fmtK(call.volume)}
                    </td>
                    <td un-bg={callBgVal} un-p="x-2 y-1.5" un-text="right emerald-600" un-cursor="pointer"
                        onClick={() => call && onSelectOption(call)}>
                        {fmt(call.bid)}
                    </td>
                    <td un-bg={callBgVal} un-p="x-2 y-1.5" un-text="right red-500" un-cursor="pointer"
                        un-border="r-2 slate-200" onClick={() => call && onSelectOption(call)}>
                        {fmt(call.ask)}
                    </td>
                </>
            ) : showCalls ? (
                <td colSpan={5} un-bg={callBgVal} un-p="x-2 y-1.5" un-text="center slate-300"
                    un-border="r-2 slate-200">—</td>
            ) : null}

            {/* ── Strike center ── */}
            <td un-p="x-3 y-1.5" un-text="center"
                un-bg={isATM ? 'amber-50' : 'slate-50'}
                un-text-color={isATM ? 'amber-600' : 'slate-700'}
                un-border={isATM ? 'l-2 r-2 amber-400' : 'l slate-200 r slate-200'}
            >
                {strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(2)}
                {isATM && <span un-ml="1" un-text="amber-400 text-xs">◆</span>}
            </td>

            {/* ── Put side ── */}
            {showPuts && put ? (
                <>
                    <td un-bg={putBgVal} un-p="x-2 y-1.5" un-text="emerald-600" un-cursor="pointer"
                        un-border="l-2 slate-200" onClick={() => put && onSelectOption(put)}>
                        {fmt(put.bid)}
                    </td>
                    <td un-bg={putBgVal} un-p="x-2 y-1.5" un-text="right red-500" un-cursor="pointer"
                        onClick={() => put && onSelectOption(put)}>
                        {fmt(put.ask)}
                    </td>
                    <td un-bg={putBgVal} un-p="x-2 y-1.5" un-text="right slate-600" un-cursor="pointer"
                        onClick={() => put && onSelectOption(put)}>
                        {fmtK(put.volume)}
                    </td>
                    <td un-bg={putBgVal} un-p="x-2 y-1.5" un-text="right red-500" un-cursor="pointer"
                        onClick={() => put && onSelectOption(put)}>
                        {fmt(put.delta, 3)}
                    </td>
                    <td un-bg={putBgVal} un-p="x-2 y-1.5" un-text="right slate-600" un-cursor="pointer"
                        onClick={() => put && onSelectOption(put)}>
                        {fmtIV(put.impliedVolatility)}
                    </td>
                </>
            ) : showPuts ? (
                <td colSpan={5} un-bg={putBgVal} un-p="x-2 y-1.5" un-text="center slate-300"
                    un-border="l-2 slate-200">—</td>
            ) : null}
        </tr>
    )
}

// ── Option Chart Panel ─────────────────────────────────────────────────────────

function OptionChartPanel({ option, onClose }: { option: OptionSnapshot; onClose: () => void }) {
    const [timeframe, setTimeframe] = useState<TF>('1Day')
    const [bars, setBars] = useState<OptionBar[]>([])
    const [chartLoading, setChartLoading] = useState(false)
    const [chartError, setChartError] = useState<string | null>(null)

    // Load bars when option or timeframe changes
    useEffect(() => {
        let cancelled = false
        setChartLoading(true)
        setChartError(null)
        setBars([])

        const tf = TIMEFRAMES.find(t => t.value === timeframe)!
        const start = barStartDate(tf.startDays)

        fetchOptionBars({ data: { contractSymbol: option.symbol, timeframe, start } })
            .then(data => { if (!cancelled) setBars(data.bars) })
            .catch(e => { if (!cancelled) setChartError(e.message) })
            .finally(() => { if (!cancelled) setChartLoading(false) })

        return () => { cancelled = true }
    }, [option.symbol, timeframe])

    const isCall = option.optionType === 'call'
    const typeLabel = isCall ? 'CALL' : 'PUT'
    const typeColor = isCall ? 'emerald-600' : 'red-500'

    return (
        <div un-flex="~ col" un-h="full" >
            {/* Panel header */}
            <div un-flex="~ items-start justify-between" un-p="x-3 y-2" un-border="b slate-200">
                <div un-flex='~ col gap-1'>
                    <div un-flex="~ items-center gap-2">
                        <span un-font="bold" un-text="base slate-800">
                            {option.underlying} {option.strikePrice % 1 === 0
                                ? option.strikePrice.toFixed(0)
                                : option.strikePrice.toFixed(2)}
                        </span>
                        <span un-text={`sm ${typeColor}`}>{typeLabel}</span>
                        <span un-text="xs slate-400">{formatExpiryFull(option.expirationDate)}</span>
                    </div>
                    <div un-flex="~ gap-4 items-center" un-text="xs">
                        <span un-text="slate-500">
                            Bid <span un-font="mono emerald-600">{fmt(option.bid)}</span>
                        </span>
                        <span un-text="slate-500">
                            Ask <span un-font="mono red-500">{fmt(option.ask)}</span>
                        </span>
                        <span un-text="slate-500">
                            Last <span un-font="mono slate-800">{fmt(option.last)}</span>
                        </span>
                        <span un-text="slate-500">
                            IV <span un-font="mono slate-700">{fmtIV(option.impliedVolatility)}</span>
                        </span>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    un-p="1.5" un-rounded="lg" un-cursor="pointer" un-transition="colors"
                    un-bg="hover:slate-100" un-text="slate-400 hover:slate-600"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Greeks row */}
            <div un-flex="~ gap-4 items-center" un-p="x-3 y-1.5" un-border="b slate-100"
                un-bg="slate-50/50" un-text="xs">
                <GreekBadge label="Δ Delta" value={fmt(option.delta, 4)} color={isCall ? 'emerald-600' : 'red-500'} />
                <GreekBadge label="Γ Gamma" value={fmt(option.gamma, 4)} color="slate-600" />
                <GreekBadge label="Θ Theta" value={fmt(option.theta, 4)} color="red-500" />
                <GreekBadge label="V Vega" value={fmt(option.vega, 4)} color="blue-600" />
                <GreekBadge label="ρ Rho" value={fmt(option.rho, 4)} color="slate-500" />
            </div>

            {/* Timeframe selector */}
            <div un-flex="~ items-center gap-1" un-p="x-3 y-1.5" un-border="b slate-100">
                <span un-text="xs slate-400 mr-1">Timeframe: </span>
                {TIMEFRAMES.map(tf => (
                    <button key={tf.value}
                        onClick={() => setTimeframe(tf.value)}
                        un-p="x-2.5 y-0.5" un-text="xs" un-cursor="pointer" un-transition="all"
                        un-border="~ rounded-md"
                        un-bg={timeframe === tf.value ? 'blue-600' : 'white hover:slate-50'}
                        un-text-color={timeframe === tf.value ? 'white' : 'slate-600'}
                        un-border-color={timeframe === tf.value ? 'blue-600' : 'slate-200'}
                    >
                        {tf.label}
                    </button>
                ))}
                {bars.length > 0 && (
                    <span un-text="xs slate-400 ml-auto">{bars.length} bars</span>
                )}
            </div>

            {/* Chart area */}
            <div un-h='full' un-overflow="hidden" un-position="relative">
                {chartLoading && (
                    <div un-position="absolute" un-inset="0" un-flex="~ items-center justify-center" un-bg="white/80" un-z="10">
                        <div un-w="8" un-h="8" un-border="3 blue-500 t-transparent" un-rounded="full" un-animate="spin" />
                    </div>
                )}
                {chartError && (
                    <div un-p="6" un-text="center red-600 sm">{chartError}</div>
                )}
                {!chartLoading && !chartError && bars.length === 0 && (
                    <div un-p="6" un-text="center slate-400 sm">No price data available for this contract.</div>
                )}
                {bars.length > 0 && (
                    <OHLCChart bars={bars} timeframe={timeframe} />
                )}
            </div>
        </div>
    )
}

function GreekBadge({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div un-flex="~ col items-center" un-min-w="12">
            <span un-text="slate-400">{label}</span>
            <span un-font="mono bold" un-text-color={color}>{value}</span>
        </div>
    )
}

// ── OHLC Chart ────────────────────────────────────────────────────────────────

function OHLCChart({ bars, timeframe }: { bars: OptionBar[]; timeframe: TF }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const isIntraday = timeframe !== '1Day'

    useEffect(() => {
        if (!containerRef.current || bars.length === 0) return

        const chart = createChart(containerRef.current)

        // Candle series
        const candleSeries = chart.addSeries(CandlestickSeries)

        candleSeries.setData(bars.map(b => ({
            time: (isIntraday ? Math.floor(new Date(b.t).getTime() / 1000) : b.t.slice(0, 10)) as any,
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
        })))

        // Volume histogram (bottom 20%)
        const volSeries = chart.addSeries(HistogramSeries, {
            priceScaleId: 'vol',
            lastValueVisible: false,
        })
        chart.priceScale('vol').applyOptions({
            scaleMargins: { top: 0.9, bottom: 0 },
        })
        volSeries.setData(bars.map(b => ({
            time: (isIntraday
                ? Math.floor(new Date(b.t).getTime() / 1000)
                : b.t.slice(0, 10)) as any,
            value: b.v,
            color: b.c >= b.o ? '#10b98150' : '#ef444450',
        })))

        chart.timeScale().fitContent()

        // Resize observer
        const ro = new ResizeObserver(() => {
            if (containerRef.current) {
                chart.applyOptions({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight,
                })
            }
        })
        ro.observe(containerRef.current)

        return () => {
            ro.disconnect()
            chart.remove()
        }
    }, [bars, isIntraday])

    return (
        <div ref={containerRef} un-w="full" un-h="full" />
    )
}

// UnoCSS dynamic class safelist — ensures all runtime class values are generated
export const _UnoSafelist = (
    <div
        un-bg="blue-600 blue-300 blue-100 emerald-500 emerald-50 emerald-200 red-500 red-50 red-200 amber-50 slate-50 slate-100 white hover:slate-50 hover:slate-100 hover:blue-700 hover:slate-50/80 disabled:blue-300"
        un-text-color="white slate-400 slate-500 slate-600 slate-700 slate-800 emerald-600 red-500 amber-600 blue-600"
        un-border-color="blue-600 emerald-500 red-500 slate-200 amber-400"
        un-border="r-2 l-2 slate-200 amber-400 b slate-100"
    />
)
