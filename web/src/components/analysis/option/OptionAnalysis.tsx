import { getOptionOpenInterestData, type YahooOptionChainResult } from '@/utils/yahoo'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CHART_MODES, METRIC_VIEWS } from './option-analysis/constants'
import { OptionBarChart } from './option-analysis/OptionBarChart'
import { OptionGex } from './option-analysis/OptionGex'
import { OptionVolatility } from './option-analysis/OptionVolatility'
import type { ChartMode, MaxPainResult, MetricView } from './option-analysis/types'
import {
    buildCacheKey,
    calculateMaxPain,
    clearSymbolCache,
    deriveStrikeMetrics,
    findChainForDate,
    formatCompactNumber,
    formatExpirationDate,
    getFirstChain
} from './option-analysis/utils'

type OptionAnalysisProps = {
    symbol: string
}

export function OptionAnalysis({ symbol }: OptionAnalysisProps) {
    const [mode, setMode] = useState<ChartMode>('split')
    const [metricView, setMetricView] = useState<MetricView>('openInterest')
    const [selectedDate, setSelectedDate] = useState<number | null>(null)
    const [chainResult, setChainResult] = useState<YahooOptionChainResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const normalizedSymbol = symbol.trim().toUpperCase()
    const cacheRef = useRef<Map<string, YahooOptionChainResult>>(new Map())
    const [maxPainCache, setMaxPainCache] = useState<Map<number, MaxPainResult>>(new Map())
    const requestIdRef = useRef(0)

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
                data: {
                    symbol: normalizedSymbol,
                    date,
                },
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
            const message = err instanceof Error ? err.message : 'Failed to load option chain.'
            setError(message)
            return null
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false)
            }
        }
    }

    useEffect(() => {
        setSelectedDate(null)
        setChainResult(null)
        setError(null)

        let mounted = true
            ; (async () => {
                const response = await loadOptionChain(undefined, false)
                if (!mounted || !response) return
                const firstDate = response.options[0]?.expirationDate ?? response.expirationDates[0] ?? null
                setSelectedDate(firstDate)
            })()

        return () => {
            mounted = false
        }
    }, [normalizedSymbol])

    const expirationDates = (chainResult?.expirationDates ?? []).slice().sort((a, b) => a - b)

    const activeChain = (() => {
        if (!chainResult || chainResult.options.length === 0) return null
        if (selectedDate == null) return getFirstChain(chainResult)
        return findChainForDate(chainResult, selectedDate)
    })()

    const strikes = deriveStrikeMetrics(activeChain)

    const totals = strikes.reduce(
        (acc, strike) => {
            acc.callOpenInterest += strike.callOpenInterest
            acc.putOpenInterest += strike.putOpenInterest
            acc.callVolume += strike.callVolume
            acc.putVolume += strike.putVolume
            return acc
        },
        { callOpenInterest: 0, putOpenInterest: 0, callVolume: 0, putVolume: 0 },
    )

    useEffect(() => {
        if (!activeChain) return

        setMaxPainCache(prev => {
            if (prev.has(activeChain.expirationDate)) {
                return prev
            }
            const maxPain = calculateMaxPain(activeChain)
            if (maxPain) {
                return new Map(prev).set(activeChain.expirationDate, maxPain)
            }
            return prev
        })
    }, [activeChain])

    const quote = chainResult?.quote
    const oiPutCallRatio = totals.callOpenInterest > 0 ? totals.putOpenInterest / totals.callOpenInterest : 0
    const volumePutCallRatio = totals.callVolume > 0 ? totals.putVolume / totals.callVolume : 0

    const onDateClick = (date: number) => {
        setSelectedDate(date)
        void loadOptionChain(date, false)
    }

    const onRefresh = () => {
        clearSymbolCache(cacheRef.current, normalizedSymbol)
        setMaxPainCache(new Map())
        void loadOptionChain(selectedDate ?? undefined, true)
    }


    return (
        <section un-w='6xl' un-border="~ slate-200 rounded-xl" un-p="4" un-flex="~ col gap-4">
            <header un-flex="~ justify-between">
                <div un-flex="~  gap-4">
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

                <div un-flex='~ items-center gap-2 wrap' >
                    <p un-text="sm slate-500">
                        ${quote?.regularMarketPrice}
                    </p>

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
                    <OptionBarChart strikes={strikes} mode={mode} metricView={metricView} spotPrice={quote?.regularMarketPrice} />

                    <div un-grid="~" un-text="sm slate-600">
                        {(metricView === 'openInterest' || metricView === 'both') && (
                            <div un-flex="~ gap-2">
                                <span>
                                    Call OI: <strong un-text="green-700">{formatCompactNumber(totals.callOpenInterest)}</strong>
                                </span>
                                <span>
                                    Put OI: <strong un-text="red-700">{formatCompactNumber(totals.putOpenInterest)}</strong>
                                </span>
                                <span>
                                    Net OI: <strong>{formatCompactNumber(totals.callOpenInterest - totals.putOpenInterest)}</strong>
                                </span>
                                <span>
                                    Put Call Ratio: <strong un-text={oiPutCallRatio > 1 ? 'red-700' : 'green-700'}>{oiPutCallRatio?.toFixed(2)}</strong>
                                </span>
                            </div>
                        )}
                        {(metricView === 'volume' || metricView === 'both') && (
                            <div un-flex="~ gap-2">
                                <span>
                                    Call Vol: <strong un-text="green-500">{formatCompactNumber(totals.callVolume)}</strong>
                                </span>
                                <span>
                                    Put Vol: <strong un-text="red-500">{formatCompactNumber(totals.putVolume)}</strong>
                                </span>
                                <span>
                                    Net Vol: <strong>{formatCompactNumber(totals.callVolume - totals.putVolume)}</strong>
                                </span>
                                <span>
                                    Put Call Ratio: <strong un-text={volumePutCallRatio > 1 ? 'red-700' : 'green-700'}>{volumePutCallRatio?.toFixed(2)}</strong>
                                </span>
                            </div>
                        )}
                    </div>
                </>
            )}

            <OptionGex chain={activeChain} spotPrice={quote?.regularMarketPrice} />
            <OptionVolatility symbol={normalizedSymbol} chain={activeChain} spotPrice={quote?.regularMarketPrice} />

            <div un-flex="~ col gap-2">
                {
                    [...maxPainCache.keys()].
                        sort()
                        .map(key => {
                            const maxPain = maxPainCache.get(key)
                            if (!maxPain) return null

                            const gap = maxPain.strike - (quote?.regularMarketPrice ?? 0)

                            return <div key={key} un-border="~ sky-200 rounded-lg" un-bg="sky-50" un-p="2" un-flex="~ col gap-1">
                                <p un-text="sm" >
                                    {formatExpirationDate(key, true)} Max Pain: <span un-font="bold" > ${maxPain.strike}</span>
                                </p>
                                <div un-text="xs" un-flex="~ gap-4 wrap">
                                    <span>
                                        Call Payout: <strong>${formatCompactNumber(maxPain.callValue ?? 0)}</strong>
                                    </span>
                                    <span>
                                        Put Payout: <strong>${formatCompactNumber(maxPain.putValue ?? 0)}</strong>
                                    </span>
                                    <span>
                                        Total Payout: <strong>${formatCompactNumber(maxPain.totalValue ?? 0)}</strong>
                                    </span>
                                    <span>
                                        Gap vs spot: <strong>{gap > 0 ? '+' : ''}{gap.toFixed(2)}</strong>
                                    </span>
                                </div>
                            </div>
                        })
                }
            </div>
        </section>
    )
}
