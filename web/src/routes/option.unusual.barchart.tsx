import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { fetchUnusualOptions, querySchema, type QueryParams, type UnusualOption } from '../utils/barchart-unusual'

type SortField = keyof UnusualOption
type SortDir = 'asc' | 'desc'

const SORT_OPTIONS = [
    { value: 'volumeOpenInterestRatio', label: 'Vol/OI' },
    { value: 'volume', label: 'Volume' },
    { value: 'openInterest', label: 'Open Int' },
    { value: 'delta', label: 'Delta' },
    { value: 'daysToExpiration', label: 'DTE' },
    { value: 'baseLastPrice', label: 'Price' },
    { value: 'moneyness', label: 'Moneyness' },
] as const

const ASSET_TYPES = [
    { value: 'stock', label: 'Stocks' },
    { value: 'etf', label: 'ETFs' },
    { value: 'index', label: 'Indices' },
    { value: 'stock,etf', label: 'Stocks + ETFs' },
    { value: 'stock,etf,index', label: 'All' },
] as const

const LIMIT_OPTIONS = [100, 200, 500, 1000] as const

function validateSearch(search: Record<string, unknown>): QueryParams {
    return querySchema.parse({
        assetType: search.assetType ?? 'stock',
        orderBy: search.orderBy ?? 'volumeOpenInterestRatio',
        orderDir: search.orderDir ?? 'desc',
        limit: search.limit != null ? Number(search.limit) : 200,
        minVolOI: search.minVolOI != null ? Number(search.minVolOI) : 1.24,
        minVolume: search.minVolume != null ? Number(search.minVolume) : 0,
        maxDTE: search.maxDTE != null ? Number(search.maxDTE) : 0,
        showGreeks: search.showGreeks === true || search.showGreeks === 'true',
    })
}

export const Route = createFileRoute('/option/unusual/barchart')({
    head: () => ({
        meta: [{ title: 'Unusual Options Activity' }],
    }),
    validateSearch,
    loaderDeps: ({ search }) => search,
    loader: async ({ deps }) => fetchUnusualOptions({ data: deps }),
    component: UnusualOptionsPage,
    pendingComponent: () => (
        <div un-flex="~ col items-center justify-center" un-py="20">
            <div un-w="12" un-h="12" un-border="4 blue-500 t-transparent" un-rounded="full" un-animate="spin" />
            <p un-text="slate-500" un-mt="4">Loading unusual options data...</p>
        </div>
    ),
    errorComponent: ({ error }) => (
        <div un-p="8" un-text="center">
            <h2 un-text="xl" un-font="bold" un-text-color="red-600">Failed to load data</h2>
            <p un-text="slate-600" un-mt="2">{error.message}</p>
            <button
                onClick={() => window.location.reload()}
                un-mt="4" un-bg="blue-600 hover:blue-700" un-text="white" un-p="x-4 y-2" un-border="rounded-lg" un-cursor="pointer"
            >
                Retry
            </button>
        </div>
    ),
})

function UnusualOptionsPage() {
    const { options, total, fetchedAt, query } = Route.useLoaderData()
    const navigate = useNavigate({ from: '/option/unusual/barchart' })
    const [typeFilter, setTypeFilter] = useState<'all' | 'Call' | 'Put'>('all')
    const [symbolSearch, setSymbolSearch] = useState('')
    const [sortField, setSortField] = useState<SortField>('volumeOpenInterestRatio')
    const [sortDir, setSortDir] = useState<SortDir>('desc')

    function updateQuery(patch: Partial<QueryParams>) {
        navigate({ search: (prev: QueryParams) => ({ ...prev, ...patch }) })
    }

    const filtered = useMemo(() => {
        let result = options
        if (typeFilter !== 'all') {
            result = result.filter(o => o.putCall === typeFilter)
        }
        if (symbolSearch.trim()) {
            const q = symbolSearch.trim().toUpperCase()
            result = result.filter(o => o.symbol.toUpperCase().includes(q))
        }
        return [...result].sort((a, b) => {
            const aVal = a[sortField]
            const bVal = b[sortField]
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortDir === 'asc' ? aVal - bVal : bVal - aVal
            }
            return sortDir === 'asc'
                ? String(aVal).localeCompare(String(bVal))
                : String(bVal).localeCompare(String(aVal))
        })
    }, [options, typeFilter, symbolSearch, sortField, sortDir])

    const stats = useMemo(() => {
        const calls = options.filter(o => o.putCall === 'Call')
        const puts = options.filter(o => o.putCall === 'Put')
        const totalVol = options.reduce((s, o) => s + o.volume, 0)

        const symbolVol = new Map<string, number>()
        for (const o of options) {
            symbolVol.set(o.symbol, (symbolVol.get(o.symbol) ?? 0) + o.volume)
        }
        const topSymbols = [...symbolVol.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)

        return {
            total: options.length, apiTotal: total,
            calls: calls.length, puts: puts.length,
            callRatio: options.length ? ((calls.length / options.length) * 100).toFixed(1) : '0',
            totalVol, topSymbols,
        }
    }, [options, total])

    function handleSort(field: SortField) {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortDir('desc')
        }
    }

    return (
        <div un-p="x-2 y-3" un-flex="~ col" un-gap="3">
            {/* Header */}
            <div un-flex="~ justify-between items-center wrap gap-2">
                <div un-flex='~ gap-2' >
                    <h1 un-text="2xl" un-font="bold" un-text-color="slate-800">
                        ⚡ Unusual Options Activity
                    </h1>
                    <p un-text="xs slate-400" un-mt='auto' >
                        Data from Barchart • Updated {fetchedAt.replace('T', ' ').slice(0, 19)}
                    </p>
                </div>
                <button
                    onClick={() => window.location.reload()}
                    un-bg="blue-50 hover:blue-100" un-text="sm blue-700" un-p="x-3 y-1.5"
                    un-border="~ blue-200 rounded-lg" un-cursor="pointer" un-transition="all"
                >
                    ↻ Refresh
                </button>
            </div>

            {/* Query Controls — triggers server re-fetch */}
            <div un-border="~ slate-200 rounded-xl" un-p="x-3 y-1" un-bg="slate-50/50" un-flex="~ gap-4">
                <div un-flex="~ gap-1 items-center">
                    <label un-text="xs slate-500">Asset Type: </label>
                    <div un-flex="~ gap-1">
                        {ASSET_TYPES.map(at => (
                            <button key={at.value}
                                un-p="x-2.5 y-1" un-text="xs" un-cursor="pointer" un-transition="all"
                                un-border="~ rounded-md"
                                un-bg={query.assetType === at.value ? 'blue-500' : 'white hover:slate-50'}
                                un-text-color={query.assetType === at.value ? 'white' : 'slate-600'}
                                un-border-color={query.assetType === at.value ? 'blue-500' : 'slate-200'}
                                onClick={() => updateQuery({ assetType: at.value as QueryParams['assetType'] })}
                            >
                                {at.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div un-flex="~ gap-1 items-center">
                    <label un-text="xs slate-500">Sort By: </label>
                    <select
                        value={query.orderBy}
                        onChange={e => updateQuery({ orderBy: e.target.value })}
                        un-border="~ slate-200 rounded-md" un-p="x-2 y-1" un-text="xs"
                        un-cursor="pointer"
                    >
                        {SORT_OPTIONS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                    <button
                        onClick={() => updateQuery({ orderDir: query.orderDir === 'desc' ? 'asc' : 'desc' })}
                        un-border="~ slate-200 rounded-md" un-p="x-2 y-1" un-text="xs white"
                        un-bg={query.orderDir === 'desc' ? 'green-500 hover:green-800' : 'yellow-500 hover:yellow-800'}
                        un-cursor="pointer" un-transition="all"
                    >
                        {query.orderDir === 'desc' ? '↓ Desc' : '↑ Asc'}
                    </button>
                </div>

                <div un-flex="~ gap-1 items-center">
                    <label un-text="xs slate-500">Limit: </label>
                    <div un-flex="~ gap-1">
                        {LIMIT_OPTIONS.map(n => (
                            <button key={n}
                                un-p="x-2 y-1" un-text="xs" un-cursor="pointer" un-transition="all"
                                un-border="~ rounded-md"
                                un-bg={query.limit === n ? 'blue-500' : 'white hover:slate-50'}
                                un-text-color={query.limit === n ? 'white' : 'slate-600'}
                                un-border-color={query.limit === n ? 'blue-500' : 'slate-200'}
                                onClick={() => updateQuery({ limit: n })}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                </div>

                <div un-flex="~ gap-1 items-center">
                    <label un-text="xs slate-500">Min Vol/OI: </label>
                    <input type="number" step="0.1" min="0"
                        defaultValue={query.minVolOI}
                        onBlur={e => { const v = parseFloat(e.target.value) || 0; if (v !== query.minVolOI) updateQuery({ minVolOI: v }) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        un-border="~ slate-200 rounded-md" un-p="x-2 y-1" un-text="xs" un-w="16"
                        un-outline="focus:blue-400"
                    />
                </div>

                <div un-flex="~ gap-1 items-center">
                    <label un-text="xs slate-500">Min Volume: </label>
                    <input type="number" step="100" min="0"
                        defaultValue={query.minVolume}
                        onBlur={e => { const v = parseInt(e.target.value) || 0; if (v !== query.minVolume) updateQuery({ minVolume: v }) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        un-border="~ slate-200 rounded-md" un-p="x-2 y-1" un-text="xs" un-w="18"
                        un-outline="focus:blue-400"
                    />
                </div>

                <div un-flex="~ gap-1 items-center">
                    <label un-text="xs slate-500">Max DTE: </label>
                    <input type="number" step="1" min="0"
                        defaultValue={query.maxDTE || ''}
                        placeholder="any"
                        onBlur={e => { const v = parseInt(e.target.value) || 0; if (v !== query.maxDTE) updateQuery({ maxDTE: v }) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        un-border="~ slate-200 rounded-md" un-p="x-2 y-1" un-text="xs" un-w="16"
                        un-outline="focus:blue-400"
                    />
                </div>

                <div un-flex="~ gap-1 items-center">
                    <label un-text="xs slate-500">Greeks: </label>
                    <button
                        onClick={() => updateQuery({ showGreeks: !query.showGreeks })}
                        un-w="9" un-h="5" un-rounded="full" un-cursor="pointer" un-transition="all"
                        un-bg={query.showGreeks ? 'blue-600' : 'slate-300'}
                        un-p="0.5" un-flex="~ items-center"
                    >
                        <div un-w="4" un-h="4" un-rounded="full" un-bg="white" un-transition="all"
                            un-translate-x={query.showGreeks ? '4' : '0'} />
                    </button>
                </div>
            </div>

            <div un-grid="~ gap-2 cols-[repeat(auto-fit,minmax(3rem,1fr))]" >
                <MiniStat label="Total Contracts" value={stats.total.toString()} />
                <MiniStat label="Calls" value={stats.calls.toString()} color="emerald-600" />
                <MiniStat label="Puts" value={stats.puts.toString()} color="red-500" />
                <MiniStat label="Call Ratio" value={`${stats.callRatio}%`} />
                <MiniStat label="Total Volume" value={stats.totalVol.toLocaleString()} />
                <MiniStat label="From API" value={`${stats.apiTotal.toLocaleString()} total`} />
            </div>

            {/* Top Symbols */}
            <div un-flex="~ gap-2 items-center wrap" un-text="sm">
                <span un-text="xs slate-500">Top by Volume:</span>
                {stats.topSymbols.map(([sym, vol]) => (
                    <button
                        key={sym}
                        un-p="x-2 y-0.5" un-bg="slate-50 hover:blue-50" un-border="~ slate-200 rounded-lg hover:blue-300"
                        un-text="xs" un-cursor="pointer" un-transition="all"
                        onClick={() => setSymbolSearch(sym === symbolSearch ? '' : sym)}
                        un-font={symbolSearch === sym ? 'bold' : 'normal'}
                        un-text-color={symbolSearch === sym ? 'blue-700' : 'slate-700'}
                    >
                        {sym} <span un-text="slate-400">{vol.toLocaleString()}</span>
                    </button>
                ))}
            </div>

            {/* Client-side Filters */}
            <div un-flex="~ gap-3 items-center wrap" un-border="~ slate-200 rounded-xl" un-p="2">
                <div un-flex="~ gap-1 items-center">
                    {(['all', 'Call', 'Put'] as const).map(t => (
                        <button
                            key={t}
                            un-p="x-3 y-1" un-text="sm" un-cursor="pointer" un-transition="all"
                            un-border="~ rounded-lg"
                            un-bg={typeFilter === t
                                ? (t === 'Call' ? 'emerald-600' : t === 'Put' ? 'red-500' : 'blue-600')
                                : 'white hover:slate-50'}
                            un-text-color={typeFilter === t ? 'white' : 'slate-600'}
                            un-border-color={typeFilter === t
                                ? (t === 'Call' ? 'emerald-600' : t === 'Put' ? 'red-500' : 'blue-600')
                                : 'slate-200'}
                            onClick={() => setTypeFilter(t)}
                        >
                            {t === 'all' ? 'All' : t + 's'}
                        </button>
                    ))}
                </div>
                <input
                    type="text"
                    placeholder="Search symbol..."
                    value={symbolSearch}
                    onChange={e => setSymbolSearch(e.target.value)}
                    un-border="~ slate-200 rounded-lg" un-p="x-3 y-1" un-text="sm" un-w="40"
                    un-outline="focus:blue-400"
                />
                <span un-text="xs slate-400" un-ml="auto">
                    Showing {filtered.length} of {stats.total}
                </span>
            </div>

            {/* Data Table */}
            <div un-border="~ slate-200 rounded-xl" un-shadow="sm" un-h='xl' un-overflow="auto" >
                <table un-text="sm" un-w='full'>
                    <thead un-bg="slate-50" un-position="sticky" un-top="0">
                        <tr>
                            <TH field="symbol" label="Symbol" onSort={handleSort} sortField={sortField} sortDir={sortDir} align="left" />
                            <TH field="baseLastPrice" label="Price" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="expirationDate" label="Exp Date" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="putCall" label="Type" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="strikePrice" label="Strike" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="moneyness" label="Moneyness" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="bidPrice" label="Bid" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="lastPrice" label="Last" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="askPrice" label="Ask" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="volume" label="Volume" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="openInterest" label="Open Int" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="volumeOpenInterestRatio" label="Vol/OI" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            <TH field="delta" label="Delta" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            {query.showGreeks && <>
                                <TH field="gamma" label="Gamma" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                                <TH field="theta" label="Theta" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                                <TH field="vega" label="Vega" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                                <TH field="rho" label="Rho" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                            </>}
                            <TH field="tradeTime" label="Last Trade" onSort={handleSort} sortField={sortField} sortDir={sortDir} />
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((o, i) => (
                            <OptionRow key={`${o.symbol}-${o.strikePrice}-${o.expirationDate}-${o.putCall}-${i}`}
                                option={o} showGreeks={query.showGreeks} />
                        ))}
                    </tbody>
                </table>
            </div>
            {filtered.length === 0 && (
                <div un-p="8" un-text="center slate-400">
                    No options match your filters.
                </div>
            )}

            {/* Footer */}
            <div un-p="2" un-bg="slate-50" un-rounded="xl" un-text="slate-400 xs">
                📊 Data sourced from Barchart.com • Unusual activity = Vol/OI ratio ≥ {query.minVolOI} •
                Bullish sentiment in green, Bearish in red • Not financial advice
            </div>
        </div>
    )
}

// ── Sub-Components ──

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div un-border="~ slate-200 rounded-lg" un-p="2">
            <div un-text="xs slate-500">{label}</div>
            <div un-text={`lg ${color ?? 'slate-800'}`} un-font="bold">{value}</div>
        </div>
    )
}

function TH({ field, label, onSort, sortField, sortDir, align = 'right' }: {
    field: SortField; label: string; onSort: (f: SortField) => void
    sortField: SortField; sortDir: SortDir; align?: 'left' | 'right'
}) {
    const active = sortField === field
    return (
        <th
            un-p="x-2 y-2.5" un-text={`${align} xs slate-600`}
            un-cursor="pointer" un-select="none" un-transition="colors"
            un-bg={active ? 'blue-50' : 'hover:slate-100'}
            onClick={() => onSort(field)}
        >
            {label}
            <span un-text="xs" un-ml="0.5" un-opacity={active ? '100' : '30'}>
                {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
            </span>
        </th>
    )
}

function OptionRow({ option: o, showGreeks }: { option: UnusualOption; showGreeks: boolean }) {
    const isCall = o.putCall === 'Call'
    const highRatio = o.volumeOpenInterestRatio >= 5
    const moneyColor = o.moneyness >= 0 ? 'emerald-600' : 'red-500'

    return (
        <tr
            un-border="b slate-100"
            un-bg={highRatio ? (isCall ? 'emerald-50/60' : 'red-50/60') : 'hover:slate-50/80'}
            un-transition="colors"
        >
            <td un-p="x-2 y-2" un-font="bold mono" un-text="blue-700">
                {o.symbol}
            </td>
            <td un-p="x-2 y-2" un-text="right" un-font="mono">
                {o.baseLastPrice.toFixed(2)}
            </td>
            <td un-p="x-2 y-2" un-text="right">
                <span un-font="mono">{o.expirationDate} </span>
                <span un-text="xs slate-400" un-ml="1">({o.daysToExpiration}d)</span>
            </td>
            <td un-p="x-2 y-2" un-text="center">
                <span
                    un-p="x-1.5 y-0.5" un-rounded="md" un-text="xs" un-font="bold"
                    un-bg={isCall ? 'emerald-100' : 'red-100'}
                    un-text-color={isCall ? 'emerald-600' : 'red-600'}
                >
                    {o.putCall}
                </span>
            </td>
            <td un-p="x-2 y-2" un-text="right" un-font="mono">
                {o.strikePrice.toFixed(2)}
            </td>
            <td un-p="x-2 y-2" un-text="right" un-font="mono">
                <span un-text-color={moneyColor}>
                    {o.moneyness >= 0 ? '+' : ''}{(o.moneyness * 100).toFixed(2)}%
                </span>
            </td>
            <td un-p="x-2 y-2" un-text="right" un-font="mono">{o.bidPrice.toFixed(2)}</td>
            <td un-p="x-2 y-2" un-text="right" un-font="bold mono">{o.lastPrice.toFixed(2)}</td>
            <td un-p="x-2 y-2" un-text="right" un-font="mono">{o.askPrice.toFixed(2)}</td>
            <td un-p="x-2 y-2" un-text="right" un-font="bold mono">
                {o.volume.toLocaleString()}
            </td>
            <td un-p="x-2 y-2" un-text="right" un-font="mono">
                {o.openInterest.toLocaleString()}
            </td>
            <td un-p="x-2 y-2" un-text="right" un-font="bold">
                <span
                    un-text-color={o.volumeOpenInterestRatio >= 10 ? 'amber-600' : o.volumeOpenInterestRatio >= 5 ? 'orange-500' : 'slate-700'}
                >
                    {o.volumeOpenInterestRatio.toFixed(2)}
                </span>
            </td>
            <td un-p="x-2 y-2" un-text="right" un-font="mono">
                <span un-text-color={o.delta >= 0 ? 'emerald-600' : 'red-500'}>
                    {o.delta >= 0 ? '+' : ''}{o.delta.toFixed(4)}
                </span>
            </td>
            {showGreeks && <>
                <td un-p="x-2 y-2" un-text="right" un-font="mono">{(o.gamma ?? 0).toFixed(4)}</td>
                <td un-p="x-2 y-2" un-text="right" un-font="mono">
                    <span un-text-color="red-500">{(o.theta ?? 0).toFixed(4)}</span>
                </td>
                <td un-p="x-2 y-2" un-text="right" un-font="mono">{(o.vega ?? 0).toFixed(4)}</td>
                <td un-p="x-2 y-2" un-text="right" un-font="mono">{(o.rho ?? 0).toFixed(4)}</td>
            </>}
            <td un-p="x-2 y-2" un-text="right xs slate-500">
                {o.tradeTime}
            </td>
        </tr>
    )
}

// UnoCSS safelist trick to ensure dynamic classes are generated
export const UnoTrick = <div un-text="emerald-600 emerald-700 red-500 red-700 amber-600 orange-500 blue-700"
    un-bg="emerald-50/60 emerald-600 red-50/60 red-500 emerald-100 red-100 blue-50 blue-600 slate-300 hover:slate-100 hover:slate-50/80 hover:blue-50 hover:blue-100" />
