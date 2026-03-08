import { getOptionOpenInterestData, type YahooOptionChainEntry, type YahooOptionChainResult } from '@/utils/yahoo'
import { ColorType, createChart, HistogramSeries, type Time } from 'lightweight-charts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type OptionAnalysisProps = {
    symbol: string
}

type SideFilter = 'both' | 'call' | 'put'
type BothMode = 'split' | 'top' | 'net'

type StrikeOpenInterest = {
    strike: number
    callOpenInterest: number
    putOpenInterest: number
    totalOpenInterest: number
}

type HistogramPoint = {
    time: Time
    value: number
    color: string
}

const SIDE_FILTERS: Array<{ value: SideFilter; label: string }> = [
    { value: 'both', label: 'Both' },
    { value: 'call', label: 'Call' },
    { value: 'put', label: 'Put' },
]

const BOTH_MODES: Array<{ value: BothMode; label: string }> = [
    { value: 'split', label: 'Split' },
    { value: 'top', label: 'Overlay' },
    { value: 'net', label: 'Net' },
]

export function OptionAnalysis({ symbol }: OptionAnalysisProps) {
    const [sideFilter, setSideFilter] = useState<SideFilter>('both')
    const [bothMode, setBothMode] = useState<BothMode>('split')
    const [selectedDate, setSelectedDate] = useState<number | null>(null)
    const [chainResult, setChainResult] = useState<YahooOptionChainResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const normalizedSymbol = symbol.trim().toUpperCase()
    const cacheRef = useRef<Map<string, YahooOptionChainResult>>(new Map())
    const requestIdRef = useRef(0)

    const loadOptionChain = useCallback(
        async (date?: number, forceRefresh = false): Promise<YahooOptionChainResult | null> => {
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
        },
        [normalizedSymbol],
    )

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
    }, [loadOptionChain, normalizedSymbol])

    const expirationDates = useMemo(
        () => (chainResult?.expirationDates ?? []).slice().sort((a, b) => a - b),
        [chainResult],
    )

    const activeChain = useMemo(() => {
        if (!chainResult || chainResult.options.length === 0) return null
        if (selectedDate == null) return chainResult.options[0]
        return chainResult.options.find(option => option.expirationDate === selectedDate) ?? chainResult.options[0]
    }, [chainResult, selectedDate])

    const strikes = useMemo(() => deriveStrikeOpenInterest(activeChain), [activeChain])

    const totals = useMemo(() => {
        return strikes.reduce(
            (acc, strike) => {
                acc.call += strike.callOpenInterest
                acc.put += strike.putOpenInterest
                return acc
            },
            { call: 0, put: 0 },
        )
    }, [strikes])

    const quote = chainResult?.quote
    const activeExpirationDate = activeChain?.expirationDate ?? selectedDate

    const onDateClick = (date: number) => {
        setSelectedDate(date)
        void loadOptionChain(date, false)
    }

    const onRefresh = () => {
        clearSymbolCache(cacheRef.current, normalizedSymbol)
        void loadOptionChain(selectedDate ?? undefined, true)
    }

    return (
        <section un-border="~ slate-200 rounded-xl" un-bg="white" un-shadow="sm" un-p="4" un-flex="~ col gap-4">
            <header un-flex="~ items-start justify-between gap-3 wrap">
                <div un-flex="~ col gap-1">
                    <p un-text="sm slate-500">
                        ${quote?.regularMarketPrice.toFixed(2)}
                    </p>
                </div>

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
                >
                    Refresh
                </button>
            </header>

            <div un-flex="~ items-center gap-2 wrap">
                {SIDE_FILTERS.map(filter => {
                    const active = sideFilter === filter.value
                    return (
                        <button
                            key={filter.value}
                            type="button"
                            onClick={() => setSideFilter(filter.value)}
                            un-p="x-3 y-1.5"
                            un-rounded="lg"
                            un-border="~ slate-200"
                            un-text={`sm ${active ? 'white' : 'slate-600'}`}
                            un-bg={active ? 'blue-600' : 'white hover:slate-50'}
                            un-cursor="pointer"
                        >
                            {filter.label}
                        </button>
                    )
                })}
            </div>

            {sideFilter === 'both' && (
                <div un-flex="~ items-center gap-2 wrap">
                    {BOTH_MODES.map(mode => {
                        const active = bothMode === mode.value
                        return (
                            <button
                                key={mode.value}
                                type="button"
                                onClick={() => setBothMode(mode.value)}
                                un-p="x-3 y-1.5"
                                un-rounded="lg"
                                un-border="~ slate-200"
                                un-text={`xs ${active ? 'white' : 'slate-600'}`}
                                un-bg={active ? 'blue-600' : 'white hover:slate-50'}
                                un-cursor="pointer"
                            >
                                {mode.label}
                            </button>
                        )
                    })}
                </div>
            )}

            <div un-flex="~ col gap-2">
                <div un-text="sm slate-500">Expiration Dates</div>
                <div un-max-h="40" un-overflow-y="auto" un-border="~ slate-100 rounded-lg" un-p="2">
                    <div un-flex="~ gap-2 wrap">
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
                                    {formatExpirationDate(date)}
                                </button>
                            )
                        })}
                    </div>
                </div>
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
                    No open interest found for {normalizedSymbol}.
                </div>
            )}

            {!loading && !error && strikes.length > 0 && (
                <>
                    <OpenInterestChart
                        strikes={strikes}
                        sideFilter={sideFilter}
                        bothMode={bothMode}
                    />

                    <div un-flex="~ gap-4 wrap" un-text="sm slate-600">
                        <span>
                            Call OI: <strong un-text="emerald-600">{formatCompactNumber(totals.call)}</strong>
                        </span>
                        <span>
                            Put OI: <strong un-text="rose-600">{formatCompactNumber(totals.put)}</strong>
                        </span>
                        <span>
                            Net OI: <strong>{formatCompactNumber(totals.call - totals.put)}</strong>
                        </span>
                        <span>
                            Total OI: <strong>{formatCompactNumber(totals.call + totals.put)}</strong>
                        </span>
                    </div>

                    {quote && (
                        <div un-text="xs slate-400" un-flex="~ gap-3 wrap">
                            <span>Day High: {quote.regularMarketDayHigh.toFixed(2)}</span>
                            <span>Day Low: {quote.regularMarketDayLow.toFixed(2)}</span>
                            <span>Volume: {formatCompactNumber(quote.regularMarketVolume)}</span>
                        </div>
                    )}
                </>
            )}
        </section>
    )
}

function OpenInterestChart({
    strikes,
    sideFilter,
    bothMode,
}: {
    strikes: StrikeOpenInterest[]
    sideFilter: SideFilter
    bothMode: BothMode
}) {
    const containerRef = useRef<HTMLDivElement>(null)

    const chartData = useMemo(() => {
        const callBase: HistogramPoint[] = strikes.map(strike => ({
            time: strike.strike as Time,
            value: strike.callOpenInterest,
            color: '#10b981',
        }))

        const putPositive: HistogramPoint[] = strikes.map(strike => ({
            time: strike.strike as Time,
            value: strike.putOpenInterest,
            color: '#f43f5e',
        }))

        const putNegative: HistogramPoint[] = strikes.map(strike => ({
            time: strike.strike as Time,
            value: -strike.putOpenInterest,
            color: '#f43f5e',
        }))

        const netData: HistogramPoint[] = strikes.map(strike => {
            const net = strike.callOpenInterest - strike.putOpenInterest
            return {
                time: strike.strike as Time,
                value: net,
                color: net >= 0 ? '#10b981' : '#ef4444',
            }
        })

        const tickLabels = new Map<number, string>()

        if (sideFilter === 'call') {
            return {
                primary: callBase,
                secondary: [] as HistogramPoint[],
                tickLabels,
            }
        }

        if (sideFilter === 'put') {
            return {
                primary: putPositive,
                secondary: [] as HistogramPoint[],
                tickLabels,
            }
        }

        if (bothMode === 'net') {
            return {
                primary: netData,
                secondary: [] as HistogramPoint[],
                tickLabels,
            }
        }

        if (bothMode === 'split') {
            return {
                primary: callBase,
                secondary: putNegative,
                tickLabels,
            }
        }

        const strikeDiffs: number[] = []
        for (let index = 1; index < strikes.length; index += 1) {
            const diff = strikes[index].strike - strikes[index - 1].strike
            if (diff > 0) strikeDiffs.push(diff)
        }
        const minGap = strikeDiffs.length > 0 ? Math.min(...strikeDiffs) : 1
        const offset = Math.max(minGap * 0.2, 0.05)

        const overlayCall: HistogramPoint[] = []
        const overlayPut: HistogramPoint[] = []

        strikes.forEach(strike => {
            const callTime = strike.strike - offset
            const putTime = strike.strike + offset
            overlayCall.push({
                time: callTime as Time,
                value: strike.callOpenInterest,
                color: '#0f766e',
            })
            overlayPut.push({
                time: putTime as Time,
                value: strike.putOpenInterest,
                color: '#94a3b8',
            })
            tickLabels.set(callTime, formatStrike(strike.strike))
            tickLabels.set(putTime, formatStrike(strike.strike))
        })

        return {
            primary: overlayCall,
            secondary: overlayPut,
            tickLabels,
        }
    }, [bothMode, sideFilter, strikes])

    useEffect(() => {
        if (!containerRef.current || strikes.length === 0) return

        const chart = createChart(containerRef.current, {
            height: 360,
            layout: {
                background: { type: ColorType.Solid, color: '#ffffff' },
                textColor: '#64748b',
                fontSize: 12,
            },
            grid: {
                vertLines: { color: '#f1f5f9' },
                horzLines: { color: '#f1f5f9' },
            },
            rightPriceScale: {
                borderVisible: false,
            },
            leftPriceScale: {
                visible: false,
            },
            timeScale: {
                borderVisible: false,
                minBarSpacing: 0.2,
                tickMarkFormatter: (time: Time) => {
                    const numberTime = Number(time)
                    const mapped = findTickLabel(chartData.tickLabels, numberTime)
                    return mapped ?? formatStrike(numberTime)
                },
            },
            localization: {
                priceFormatter: (value: number) => formatCompactNumber(Math.abs(value)),
                timeFormatter: (time: Time) => {
                    const numberTime = Number(time)
                    const mapped = findTickLabel(chartData.tickLabels, numberTime)
                    return mapped ?? formatStrike(numberTime)
                },
            },
        })

        const primarySeries = chart.addSeries(HistogramSeries, {
            priceLineVisible: false,
            lastValueVisible: false,
        })

        const secondarySeries = chart.addSeries(HistogramSeries, {
            priceLineVisible: false,
            lastValueVisible: false,
        })

        primarySeries.setData(chartData.primary)
        secondarySeries.setData(chartData.secondary)

        chart.timeScale().fitContent()

        const resize = () => {
            if (!containerRef.current) return
            chart.applyOptions({ width: containerRef.current.clientWidth })
        }

        resize()
        window.addEventListener('resize', resize)

        return () => {
            window.removeEventListener('resize', resize)
            chart.remove()
        }
    }, [chartData, strikes.length])

    return <div ref={containerRef} un-w="full" un-h="88" />
}

function deriveStrikeOpenInterest(chain: YahooOptionChainEntry | null): StrikeOpenInterest[] {
    if (!chain) return []

    const strikeMap = new Map<number, StrikeOpenInterest>()

    const upsertStrike = (strikePrice: number): StrikeOpenInterest => {
        const existing = strikeMap.get(strikePrice)
        if (existing) return existing

        const nextStrike: StrikeOpenInterest = {
            strike: strikePrice,
            callOpenInterest: 0,
            putOpenInterest: 0,
            totalOpenInterest: 0,
        }
        strikeMap.set(strikePrice, nextStrike)
        return nextStrike
    }

    chain.calls.forEach(option => {
        const strike = upsertStrike(option.strike)
        strike.callOpenInterest += Math.max(0, option.openInterest ?? 0)
        strike.totalOpenInterest = strike.callOpenInterest + strike.putOpenInterest
    })

    chain.puts.forEach(option => {
        const strike = upsertStrike(option.strike)
        strike.putOpenInterest += Math.max(0, option.openInterest ?? 0)
        strike.totalOpenInterest = strike.callOpenInterest + strike.putOpenInterest
    })

    return Array.from(strikeMap.values())
        .filter(strike => strike.totalOpenInterest > 0)
        .sort((a, b) => a.strike - b.strike)
}

function clearSymbolCache(cache: Map<string, YahooOptionChainResult>, symbol: string) {
    const prefix = `${symbol}|`
    Array.from(cache.keys()).forEach(key => {
        if (key.startsWith(prefix)) {
            cache.delete(key)
        }
    })
}

function buildCacheKey(symbol: string, date?: number): string {
    return `${symbol}|${date ?? 'default'}`
}

function findTickLabel(labels: Map<number, string>, value: number): string | undefined {
    if (labels.has(value)) return labels.get(value)
    for (const [key, label] of labels.entries()) {
        if (Math.abs(key - value) < 1e-6) return label
    }
    return undefined
}

function formatCompactNumber(value: number): string {
    const absolute = Math.abs(value)
    if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
    if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}K`
    return `${Math.round(value)}`
}

function formatStrike(strike: number): string {
    if (!Number.isFinite(strike)) return ''
    if (Number.isInteger(strike)) return `${strike}`
    return strike.toFixed(2)
}

function formatExpirationDate(expirationDate: number): string {
    return new Date(expirationDate * 1000).toISOString().split('T')[0]
}
