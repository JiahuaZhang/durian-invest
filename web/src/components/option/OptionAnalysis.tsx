import { getOptionOpenInterestData, type YahooOptionChainEntry, type YahooOptionChainResult } from '@/utils/yahoo'
import { ColorType, createChart, HistogramSeries, type Time } from 'lightweight-charts'
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type OptionAnalysisProps = {
    symbol: string
}

type ChartMode = 'call' | 'put' | 'split' | 'overlay' | 'net'
type MetricView = 'openInterest' | 'volume' | 'both'

type StrikeMetrics = {
    strike: number
    callOpenInterest: number
    putOpenInterest: number
    callVolume: number
    putVolume: number
    totalOpenInterest: number
    totalVolume: number
}

type HistogramPoint = {
    time: Time
    value: number
    color: string
}

type SlotDescriptor = {
    id: string
    getValue: (strike: StrikeMetrics) => number
    color?: string
    getColor?: (value: number) => string
}

type ChartSeries = {
    id: string
    data: HistogramPoint[]
}

const CHART_MODES: Array<{ value: ChartMode; label: string }> = [
    { value: 'call', label: 'Call' },
    { value: 'put', label: 'Put' },
    { value: 'split', label: 'Split' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'net', label: 'Net' },
]

const METRIC_VIEWS: Array<{ value: MetricView; label: string }> = [
    { value: 'openInterest', label: 'Open Interest' },
    { value: 'volume', label: 'Volume' },
    { value: 'both', label: 'Both' },
]

const COLORS = {
    callOpenInterest: '#7bf1a8',
    putOpenInterest: '#ffc9c9',
    callVolume: '#096',
    putVolume: '#e7000b',
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

    const strikes = useMemo(() => deriveStrikeMetrics(activeChain), [activeChain])

    const totals = useMemo(() => {
        return strikes.reduce(
            (acc, strike) => {
                acc.callOpenInterest += strike.callOpenInterest
                acc.putOpenInterest += strike.putOpenInterest
                acc.callVolume += strike.callVolume
                acc.putVolume += strike.putVolume
                return acc
            },
            { callOpenInterest: 0, putOpenInterest: 0, callVolume: 0, putVolume: 0 },
        )
    }, [strikes])

    const quote = chainResult?.quote

    const onDateClick = (date: number) => {
        setSelectedDate(date)
        void loadOptionChain(date, false)
    }

    const onRefresh = () => {
        clearSymbolCache(cacheRef.current, normalizedSymbol)
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
                <div un-text="sm slate-500">Expiration Dates: </div>
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
                    <OptionBarChart strikes={strikes} mode={mode} metricView={metricView} />

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
                                    Put Call Ratio: <strong>{(totals.putOpenInterest / totals.callOpenInterest).toFixed(2)}</strong>
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
                                    Put Call Ratio: <strong>{(totals.putVolume / totals.callVolume).toFixed(2)}</strong>
                                </span>
                            </div>
                        )}
                    </div>
                </>
            )}
        </section>
    )
}

function OptionBarChart({
    strikes,
    mode,
    metricView,
}: {
    strikes: StrikeMetrics[]
    mode: ChartMode
    metricView: MetricView
}) {
    const containerRef = useRef<HTMLDivElement>(null)

    const chartData = useMemo(() => {
        return buildChartSeries(strikes, mode, metricView)
    }, [mode, metricView, strikes])

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
                priceFormatter: (value: number) => formatCompactNumber(value),
                timeFormatter: (time: Time) => {
                    const numberTime = Number(time)
                    const mapped = findTickLabel(chartData.tickLabels, numberTime)
                    return mapped ?? formatStrike(numberTime)
                },
            },
        })

        chartData.series.forEach(series => {
            const chartSeries = chart.addSeries(HistogramSeries, {
                priceLineVisible: false,
                lastValueVisible: false,
            })
            chartSeries.setData(series.data)
        })

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

function buildChartSeries(strikes: StrikeMetrics[], mode: ChartMode, metricView: MetricView): { series: ChartSeries[]; tickLabels: Map<number, string> } {
    const includeOpenInterest = metricView === 'openInterest' || metricView === 'both'
    const includeVolume = metricView === 'volume' || metricView === 'both'

    const slots: SlotDescriptor[] = []
    const pushSideSlots = (side: 'call' | 'put', sign: 1 | -1) => {
        if (includeOpenInterest) {
            slots.push({
                id: `${side}-oi`,
                getValue: strike => sign * (side === 'call' ? strike.callOpenInterest : strike.putOpenInterest),
                color: side === 'call' ? COLORS.callOpenInterest : COLORS.putOpenInterest,
            })
        }
        if (includeVolume) {
            slots.push({
                id: `${side}-vol`,
                getValue: strike => sign * (side === 'call' ? strike.callVolume : strike.putVolume),
                color: side === 'call' ? COLORS.callVolume : COLORS.putVolume,
            })
        }
    }

    if (mode === 'call') {
        pushSideSlots('call', 1)
    } else if (mode === 'put') {
        pushSideSlots('put', 1)
    } else if (mode === 'overlay') {
        pushSideSlots('put', 1)
        pushSideSlots('call', 1)
    } else if (mode === 'split') {
        pushSideSlots('put', -1)
        pushSideSlots('call', 1)
    } else {
        if (includeOpenInterest) {
            slots.push({
                id: 'net-oi',
                getValue: strike => strike.callOpenInterest - strike.putOpenInterest,
                getColor: value => (value >= 0 ? COLORS.callOpenInterest : COLORS.putOpenInterest),
            })
        }
        if (includeVolume) {
            slots.push({
                id: 'net-vol',
                getValue: strike => strike.callVolume - strike.putVolume,
                getColor: value => (value >= 0 ? COLORS.callVolume : COLORS.putVolume),
            })
        }
    }

    const tickLabels = new Map<number, string>()
    const strikeDiffs: number[] = []
    for (let index = 1; index < strikes.length; index += 1) {
        const diff = strikes[index].strike - strikes[index - 1].strike
        if (diff > 0) strikeDiffs.push(diff)
    }
    const minGap = strikeDiffs.length > 0 ? Math.min(...strikeDiffs) : 1
    const laneStep = slots.length > 1 ? Math.max(minGap * 0.12, 0.03) : 0

    const series = slots.map((slot, slotIndex) => {
        const offset = laneStep * (slotIndex - (slots.length - 1) / 2)
        const data = strikes.map(strike => {
            const value = slot.getValue(strike)
            const time = strike.strike + offset
            tickLabels.set(time, formatStrike(strike.strike))
            return {
                time: time as Time,
                value,
                color: slot.getColor ? slot.getColor(value) : (slot.color ?? '#64748b'),
            }
        })
        return {
            id: slot.id,
            data,
        }
    })

    return { series, tickLabels }
}

function deriveStrikeMetrics(chain: YahooOptionChainEntry | null): StrikeMetrics[] {
    if (!chain) return []

    const strikeMap = new Map<number, StrikeMetrics>()

    const upsertStrike = (strikePrice: number): StrikeMetrics => {
        const existing = strikeMap.get(strikePrice)
        if (existing) return existing

        const nextStrike: StrikeMetrics = {
            strike: strikePrice,
            callOpenInterest: 0,
            putOpenInterest: 0,
            callVolume: 0,
            putVolume: 0,
            totalOpenInterest: 0,
            totalVolume: 0,
        }
        strikeMap.set(strikePrice, nextStrike)
        return nextStrike
    }

    chain.calls.forEach(option => {
        const strike = upsertStrike(option.strike)
        strike.callOpenInterest += Math.max(0, option.openInterest ?? 0)
        strike.callVolume += Math.max(0, option.volume ?? 0)
        strike.totalOpenInterest = strike.callOpenInterest + strike.putOpenInterest
        strike.totalVolume = strike.callVolume + strike.putVolume
    })

    chain.puts.forEach(option => {
        const strike = upsertStrike(option.strike)
        strike.putOpenInterest += Math.max(0, option.openInterest ?? 0)
        strike.putVolume += Math.max(0, option.volume ?? 0)
        strike.totalOpenInterest = strike.callOpenInterest + strike.putOpenInterest
        strike.totalVolume = strike.callVolume + strike.putVolume
    })

    return Array.from(strikeMap.values())
        .filter(strike => strike.totalOpenInterest > 0 || strike.totalVolume > 0)
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
    const sign = value < 0 ? '-' : ''
    const absolute = Math.abs(value)
    if (absolute >= 1_000_000_000) return `${sign}${(absolute / 1_000_000_000).toFixed(1)}B`
    if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(1)}M`
    if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(1)}K`
    return `${sign}${Math.round(absolute)}`
}

function formatStrike(strike: number): string {
    if (!Number.isFinite(strike)) return ''
    if (Number.isInteger(strike)) return `${strike}`
    return strike.toFixed(2)
}

function formatExpirationDate(expirationDate: number, showDetails = false): string {
    const expDate = new Date(expirationDate * 1000)
    const dateStr = expDate.toISOString().split('T')[0]

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayOfWeek = days[expDate.getUTCDay()]

    const dateOfMonth = expDate.getUTCDate()
    const isOPEX = expDate.getUTCDay() === 5 && dateOfMonth >= 15 && dateOfMonth <= 21

    const now = new Date()
    const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const expUtc = Date.UTC(expDate.getUTCFullYear(), expDate.getUTCMonth(), expDate.getUTCDate())

    const diffDays = Math.round((expUtc - nowUtc) / (1000 * 60 * 60 * 24))

    let daysStr = ''
    if (diffDays === 0) {
        daysStr = 'today'
    } else if (diffDays === 1) {
        daysStr = '1 day'
    } else if (diffDays === -1) {
        daysStr = '-1 day'
    } else {
        daysStr = `${diffDays} days`
    }

    const opexStr = isOPEX ? 'OPEX' : ''

    if (showDetails) {
        return `${dateStr} (${daysStr} ${dayOfWeek} ${opexStr})`
    }
    return dateStr
}
