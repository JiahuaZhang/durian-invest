import { getAllOptionChainData, getOptionOpenInterestData, type MaxPainResult, type YahooOptionChainResult } from '@/utils/yahoo'
import { OptionMaxPainChart, OptionMaxPainTiles } from './option-analysis/OptionMaxPainChart'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CHART_MODES, METRIC_VIEWS } from './option-analysis/constants'
import { OptionBarChart } from './option-analysis/OptionBarChart'
import { OptionChainTable } from './option-analysis/OptionChainTable'
import { OptionGex } from './option-analysis/OptionGex'
import { OptionStrikeTable } from './option-analysis/OptionStrikeTable'
import { OptionVolatility } from './option-analysis/OptionVolatility'
import type { ChartMode, MetricView } from './option-analysis/types'
import {
    buildCacheKey,
    clearSymbolCache,
    findChainForDate,
    formatCompactNumber,
    formatExpirationDate,
    formatStrike,
    getFirstChain
} from './option-analysis/utils'

type OptionAnalysisProps = {
    symbol: string
}

type TableView = 'date' | 'multi' | 'strike'

const TABLE_VIEWS: Array<{ value: TableView; label: string }> = [
    { value: 'date', label: 'Date Focus' },
    { value: 'multi', label: 'All Dates' },
    { value: 'strike', label: 'Strike Focus' },
]

export function OptionAnalysis({ symbol }: OptionAnalysisProps) {
    const [mode, setMode] = useState<ChartMode>('split')
    const [metricView, setMetricView] = useState<MetricView>('openInterest')
    const [selectedDate, setSelectedDate] = useState<number | null>(null)
    const [chainResult, setChainResult] = useState<YahooOptionChainResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [maxPainCache, setMaxPainCache] = useState<Map<number, MaxPainResult>>(new Map())

    const [tableView, setTableView] = useState<TableView>('date')
    const [selectedStrike, setSelectedStrike] = useState<number | null>(null)
    const [allChains, setAllChains] = useState<YahooOptionChainResult | null>(null)
    const [allChainsLoading, setAllChainsLoading] = useState(false)

    const normalizedSymbol = symbol.trim().toUpperCase()
    const cacheRef = useRef<Map<string, YahooOptionChainResult>>(new Map())
    const requestIdRef = useRef(0)
    const allChainsRequestIdRef = useRef(0)

    async function loadOptionChain(date?: number, forceRefresh = false): Promise<YahooOptionChainResult | null> {
        const key = buildCacheKey(normalizedSymbol, date)

        if (!forceRefresh) {
            const cached = cacheRef.current.get(key)
            if (cached) {
                setChainResult(cached)
                setError(null)
                return cached
            }
        }

        const requestId = ++requestIdRef.current
        setLoading(true)
        setError(null)

        try {
            const response = await getOptionOpenInterestData({
                data: { symbol: normalizedSymbol, date },
            })

            if (requestId !== requestIdRef.current) return null

            cacheRef.current.set(key, response)
            const responseDate = response.options[0]?.expirationDate
            if (typeof responseDate === 'number') {
                cacheRef.current.set(buildCacheKey(normalizedSymbol, responseDate), response)
            }

            setChainResult(response)
            return response
        } catch (err: unknown) {
            if (requestId !== requestIdRef.current) return null
            setError(err instanceof Error ? err.message : 'Failed to load option chain.')
            return null
        } finally {
            if (requestId === requestIdRef.current) setLoading(false)
        }
    }

    async function loadAllChains() {
        const requestId = ++allChainsRequestIdRef.current
        setAllChainsLoading(true)
        try {
            const response = await getAllOptionChainData({ data: { symbol: normalizedSymbol } })
            if (requestId !== allChainsRequestIdRef.current) return
            setAllChains(response)
            setMaxPainCache(prev => {
                const next = new Map(prev)
                response.options.forEach(chain => {
                    if (chain.maxPain && !next.has(chain.expirationDate)) {
                        next.set(chain.expirationDate, chain.maxPain!)
                    }
                })
                return next
            })
        } catch {
            // silently ignore; allChains stays null
        } finally {
            if (requestId === allChainsRequestIdRef.current) setAllChainsLoading(false)
        }
    }

    useEffect(() => {
        setSelectedDate(null)
        setChainResult(null)
        setError(null)
        setAllChains(null)
        setSelectedStrike(null)
        allChainsRequestIdRef.current++

        let mounted = true;
        (async () => {
            const response = await loadOptionChain(undefined, false)
            if (!mounted || !response) return
            const firstDate = response.options[0]?.expirationDate ?? response.expirationDates[0] ?? null
            setSelectedDate(firstDate)
        })()

        return () => { mounted = false }
    }, [normalizedSymbol])

    const expirationDates = (chainResult?.expirationDates ?? []).slice().sort((a, b) => a - b)

    const activeChain = (() => {
        if (!chainResult || chainResult.options.length === 0) return null
        if (selectedDate == null) return getFirstChain(chainResult)
        return findChainForDate(chainResult, selectedDate)
    })()

    const strikes = activeChain?.strikeMetrics ?? []

    const totals = strikes.reduce(
        (acc, s) => {
            acc.callOpenInterest += s.callOpenInterest
            acc.putOpenInterest += s.putOpenInterest
            acc.callVolume += s.callVolume
            acc.putVolume += s.putVolume
            return acc
        },
        { callOpenInterest: 0, putOpenInterest: 0, callVolume: 0, putVolume: 0 },
    )

    useEffect(() => {
        if (!activeChain?.maxPain || maxPainCache.has(activeChain.expirationDate)) return
        setMaxPainCache(prev => new Map(prev).set(activeChain.expirationDate, activeChain.maxPain!))
    }, [activeChain])

    const quote = chainResult?.quote
    const spotPrice = quote?.regularMarketPrice
    const oiPutCallRatio = totals.callOpenInterest > 0 ? totals.putOpenInterest / totals.callOpenInterest : 0
    const volumePutCallRatio = totals.callVolume > 0 ? totals.putVolume / totals.callVolume : 0

    const availableStrikes = chainResult?.strikes ?? []
    const atmStrike = spotPrice != null && availableStrikes.length > 0
        ? availableStrikes.reduce((best, s) => Math.abs(s - spotPrice) < Math.abs(best - spotPrice) ? s : best, availableStrikes[0])
        : null

    function onTableViewChange(view: TableView) {
        setTableView(view)
        if (view !== 'date' && allChains === null && !allChainsLoading) {
            void loadAllChains()
        }
        if (view === 'strike' && selectedStrike === null && atmStrike != null) {
            setSelectedStrike(atmStrike)
        }
    }

    const onDateClick = (date: number) => {
        setSelectedDate(date)
        void loadOptionChain(date, false)
    }

    const onRefresh = () => {
        clearSymbolCache(cacheRef.current, normalizedSymbol)
        setAllChains(null)
        setMaxPainCache(new Map())
        allChainsRequestIdRef.current++
        void loadOptionChain(selectedDate ?? undefined, true)
        if (tableView !== 'date') void loadAllChains()
    }

    const chainTableSection = (
        <div un-flex="~ col gap-3">
            {/* View mode toggle */}
            <div un-flex="~ gap-2 items-center wrap">
                <span un-text="xs slate-500">Chain View:</span>
                {TABLE_VIEWS.map(v => {
                    const active = tableView === v.value
                    return (
                        <button
                            key={v.value}
                            type="button"
                            onClick={() => onTableViewChange(v.value)}
                            un-p="x-2.5 y-1"
                            un-rounded="lg"
                            un-border="~ slate-200"
                            un-text={`xs ${active ? 'white' : 'slate-600'}`}
                            un-bg={active ? 'violet-600' : 'white hover:slate-50'}
                            un-cursor="pointer"
                        >
                            {v.label}
                        </button>
                    )
                })}
                {allChainsLoading && (
                    <span un-text="xs slate-400">
                        Loading all dates…
                    </span>
                )}
                {!allChainsLoading && allChains != null && tableView !== 'date' && (
                    <span un-text="xs slate-400">
                        {allChains.options.length} dates loaded
                    </span>
                )}
            </div>

            {/* Strike selector — only in strike mode */}
            {tableView === 'strike' && availableStrikes.length > 0 && (
                <div un-flex="~ gap-1 wrap items-center">
                    <span un-text="xs slate-500">Strike:</span>
                    {availableStrikes.map(s => {
                        const active = selectedStrike === s
                        const isATM = s === atmStrike
                        return (
                            <button
                                key={s}
                                type="button"
                                onClick={() => setSelectedStrike(s)}
                                un-p="x-2 y-0.5"
                                un-rounded="md"
                                un-border={`~ ${isATM ? 'blue-400' : 'slate-200'}`}
                                un-text={`xs ${active ? 'white' : isATM ? 'blue-600' : 'slate-600'}`}
                                un-bg={active ? 'violet-600' : isATM ? 'blue-50 hover:blue-100' : 'white hover:slate-50'}
                                un-cursor="pointer"
                            >
                                {formatStrike(s)}
                            </button>
                        )
                    })}
                </div>
            )}

            {/* Table content */}
            {tableView === 'date' && (
                <OptionChainTable chain={activeChain} spotPrice={spotPrice} />
            )}

            {tableView === 'multi' && (
                allChainsLoading
                    ? <div un-text="sm slate-400" un-p="4">Loading all expiration dates…</div>
                    : (allChains?.options ?? []).map(chain => (
                        <div key={chain.expirationDate} un-flex="~ col gap-1">
                            <div un-text="xs slate-500" un-p="x-1">
                                {formatExpirationDate(chain.expirationDate, true)}
                            </div>
                            <OptionChainTable chain={chain} spotPrice={spotPrice} />
                        </div>
                    ))
            )}

            {tableView === 'strike' && (
                allChainsLoading
                    ? <div un-text="sm slate-400" un-p="4">Loading all expiration dates…</div>
                    : selectedStrike != null
                        ? <OptionStrikeTable chains={allChains?.options ?? []} strike={selectedStrike} spotPrice={spotPrice} />
                        : <div un-text="sm slate-400" un-p="4">Select a strike above</div>
            )}
        </div>
    )

    return (
        <section un-w='6xl' un-border="~ slate-200 rounded-xl" un-p="4" un-flex="~ col gap-4">

            <div un-flex="~ gap-2 wrap items-center">
                <div un-text="sm slate-500">Expiration Dates:</div>
                {expirationDates.map(date => {
                    const active = selectedDate === date
                    return (
                        <button
                            key={date}
                            type="button"
                            onClick={() => onDateClick(date)}
                            un-p="x-2.5 y-1.5"
                            un-rounded="lg"
                            un-border="~ slate-200"
                            un-text={`xs ${active ? 'white' : 'slate-600'}`}
                            un-bg={active ? 'blue-600' : 'white hover:slate-50'}
                            un-cursor="pointer"
                        >
                            {formatExpirationDate(date, active)}
                        </button>
                    )
                })}
            </div>

            {chainTableSection}

            <header un-flex="~ justify-between">
                <div un-flex="~ gap-4">
                    <div un-flex="~ gap-2">
                        {CHART_MODES.map(option => {
                            const active = mode === option.value
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setMode(option.value)}
                                    un-p="x-3 y-1.5"
                                    un-rounded="lg"
                                    un-border="~ slate-200"
                                    un-text={`sm ${active ? 'white' : 'slate-600'}`}
                                    un-bg={active ? 'blue-600' : 'white hover:slate-50'}
                                    un-cursor="pointer"
                                >
                                    {option.label}
                                </button>
                            )
                        })}
                    </div>

                    <div un-w="0.5" un-h="full" un-bg="slate-200" />

                    <div un-flex="~ gap-2">
                        {METRIC_VIEWS.map(option => {
                            const active = metricView === option.value
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setMetricView(option.value)}
                                    un-p="x-3 y-1.5"
                                    un-rounded="lg"
                                    un-border="~ slate-200"
                                    un-text={`xs ${active ? 'white' : 'slate-600'}`}
                                    un-bg={active ? 'green-600' : 'white hover:slate-50'}
                                    un-cursor="pointer"
                                >
                                    {option.label}
                                </button>
                            )
                        })}
                    </div>
                </div>

                <div un-flex="~ items-center gap-2 wrap">
                    <p un-text="sm slate-500">${spotPrice}</p>

                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        un-p="x-3 y-1.5"
                        un-rounded="lg"
                        un-border="~ slate-200"
                        un-bg={loading ? 'slate-100' : 'white hover:slate-50'}
                        un-text="sm slate-700"
                        un-cursor={loading ? 'not-allowed' : 'pointer'}
                        un-flex="~ items-center gap-2"
                    >
                        <RefreshCw size={14} />
                        Refresh
                    </button>
                </div>
            </header>

            {loading && (
                <div un-h="88" un-flex="~ items-center justify-center" un-text="slate-500">
                    Loading option chain...
                </div>
            )}

            {!loading && error && (
                <div un-border="~ red-200 rounded-lg" un-bg="red-50" un-p="3" un-text="sm red-600">
                    {error}
                </div>
            )}

            {!loading && !error && strikes.length === 0 && (
                <div un-border="~ amber-200 rounded-lg" un-bg="amber-50" un-p="3" un-text="sm amber-700">
                    No open interest or volume data found for {normalizedSymbol}.
                </div>
            )}

            {!loading && !error && strikes.length > 0 && (
                <>
                    <OptionBarChart strikes={strikes} mode={mode} metricView={metricView} spotPrice={spotPrice} />

                    <div un-flex="~ justify-between" un-text="sm slate-600">
                        <div un-flex="~ gap-2">
                            <span>Call OI: <strong un-text="green-700">{formatCompactNumber(totals.callOpenInterest)}</strong></span>
                            <span>Put OI: <strong un-text="red-700">{formatCompactNumber(totals.putOpenInterest)}</strong></span>
                            <span>Net OI: <strong>{formatCompactNumber(totals.callOpenInterest - totals.putOpenInterest)}</strong></span>
                            <span>Put Call Ratio: <strong un-text={oiPutCallRatio > 1 ? 'red-700' : 'green-700'}>{oiPutCallRatio.toFixed(2)}</strong></span>
                        </div>
                        <div un-flex="~ gap-2">
                            <span>Call Vol: <strong un-text="green-500">{formatCompactNumber(totals.callVolume)}</strong></span>
                            <span>Put Vol: <strong un-text="red-500">{formatCompactNumber(totals.putVolume)}</strong></span>
                            <span>Net Vol: <strong>{formatCompactNumber(totals.callVolume - totals.putVolume)}</strong></span>
                            <span>Put Call Ratio: <strong un-text={volumePutCallRatio > 1 ? 'red-700' : 'green-700'}>{volumePutCallRatio.toFixed(2)}</strong></span>
                        </div>
                    </div>
                </>
            )}

            <OptionGex chain={activeChain} spotPrice={spotPrice} />
            <OptionVolatility symbol={normalizedSymbol} chain={activeChain} spotPrice={spotPrice} />

            {maxPainCache.size > 0 && (
                allChains != null
                    ? <OptionMaxPainChart maxPainCache={maxPainCache} spotPrice={spotPrice} />
                    : <OptionMaxPainTiles maxPainCache={maxPainCache} spotPrice={spotPrice} />
            )}
        </section>
    )
}
