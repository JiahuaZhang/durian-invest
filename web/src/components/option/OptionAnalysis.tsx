import { getOptionOpenInterestData, type OptionOpenInterestProfile, type OptionOpenInterestStrike } from '@/utils/yahoo'
import { ColorType, createChart, HistogramSeries, type Time } from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'

type OptionAnalysisProps = {
    symbol: string
}

type OptionSideFilter = 'both' | 'call' | 'put'

const FILTERS: Array<{ value: OptionSideFilter; label: string }> = [
    { value: 'both', label: 'Both' },
    { value: 'call', label: 'Call' },
    { value: 'put', label: 'Put' },
]

export function OptionAnalysis({ symbol }: OptionAnalysisProps) {
    const [mode, setMode] = useState<OptionSideFilter>('both')
    const [data, setData] = useState<OptionOpenInterestProfile | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const normalizedSymbol = symbol.trim().toUpperCase()

    useEffect(() => {
        let isMounted = true
        setLoading(true)
        setError(null)
        setData(null)

        getOptionOpenInterestData({ data: { symbol: normalizedSymbol } })
            .then(profile => {
                if (!isMounted) return
                setData(profile)
            })
            .catch((err: unknown) => {
                if (!isMounted) return
                const message = err instanceof Error ? err.message : 'Failed to load option open-interest data.'
                setError(message)
            })
            .finally(() => {
                if (!isMounted) return
                setLoading(false)
            })

        return () => {
            isMounted = false
        }
    }, [normalizedSymbol])

    const totals = useMemo(() => {
        if (!data) return null
        return data.strikes.reduce(
            (acc, strike) => {
                acc.call += strike.callOpenInterest
                acc.put += strike.putOpenInterest
                return acc
            },
            { call: 0, put: 0 },
        )
    }, [data])

    return (
        <section un-border="~ slate-200 rounded-xl" un-bg="white" un-shadow="sm" un-p="4" un-flex="~ col gap-4" un-w="6xl">
            <header un-flex="~ items-start justify-between gap-3 wrap">
                <div un-flex="~ col gap-1">
                    <h3 un-text="lg slate-800" un-font="semibold">
                        Option Open Interest
                    </h3>
                    <p un-text="sm slate-500">
                        {normalizedSymbol}
                        {data ? ` • Expiration ${data.expirationDateLabel} • Spot $${data.price.toFixed(2)}` : ''}
                    </p>
                </div>

                <div un-flex="~ items-center gap-2">
                    {FILTERS.map(filter => {
                        const active = mode === filter.value
                        return (
                            <button
                                key={filter.value}
                                type="button"
                                onClick={() => setMode(filter.value)}
                                un-p="x-3 y-1.5"
                                un-rounded="lg"
                                un-border="~ slate-200"
                                un-text={`sm ${active ? 'white' : 'slate-600'}`}
                                un-bg={active ? 'slate-800' : 'white hover:slate-50'}
                                un-cursor="pointer"
                            >
                                {filter.label}
                            </button>
                        )
                    })}
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

            {!loading && !error && data && data.strikes.length === 0 && (
                <div un-border="~ amber-200 rounded-lg" un-bg="amber-50" un-p="3" un-text="sm amber-700">
                    No open interest found for {normalizedSymbol}.
                </div>
            )}

            {!loading && !error && data && data.strikes.length > 0 && (
                <>
                    <OpenInterestChart strikes={data.strikes} mode={mode} />

                    {totals && (
                        <div un-flex="~ gap-4 wrap" un-text="sm slate-600">
                            <span>
                                Call OI: <strong un-text="emerald-600">{formatCompactNumber(totals.call)}</strong>
                            </span>
                            <span>
                                Put OI: <strong un-text="rose-600">{formatCompactNumber(totals.put)}</strong>
                            </span>
                            <span>
                                Total OI: <strong>{formatCompactNumber(totals.call + totals.put)}</strong>
                            </span>
                        </div>
                    )}

                    {mode === 'both' && (
                        <p un-text="xs slate-400">
                            In Both mode, put open interest is plotted below zero to separate call vs put bars.
                        </p>
                    )}
                </>
            )}
        </section>
    )
}

function OpenInterestChart({ strikes, mode }: { strikes: OptionOpenInterestStrike[]; mode: OptionSideFilter }) {
    const containerRef = useRef<HTMLDivElement>(null)

    const callData = useMemo(
        () =>
            strikes.map(strike => ({
                time: strike.strike as Time,
                value: strike.callOpenInterest,
                color: '#10b981',
            })),
        [strikes],
    )

    const putData = useMemo(
        () =>
            strikes.map(strike => ({
                time: strike.strike as Time,
                value: mode === 'both' ? -strike.putOpenInterest : strike.putOpenInterest,
                color: '#f43f5e',
            })),
        [mode, strikes],
    )

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
                tickMarkFormatter: (time: Time) => formatStrike(Number(time)),
            },
            localization: {
                priceFormatter: (value: number) => formatCompactNumber(Math.abs(value)),
                timeFormatter: (time: Time) => formatStrike(Number(time)),
            },
        })

        const callSeries = chart.addSeries(HistogramSeries, {
            priceLineVisible: false,
            lastValueVisible: false,
        })

        const putSeries = chart.addSeries(HistogramSeries, {
            priceLineVisible: false,
            lastValueVisible: false,
        })

        callSeries.setData(mode === 'put' ? [] : callData)
        putSeries.setData(mode === 'call' ? [] : putData)

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
    }, [callData, mode, putData, strikes.length])

    return <div ref={containerRef} un-w="full" un-h="88" />
}

function formatCompactNumber(value: number): string {
    const absolute = Math.abs(value)
    if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}K`
    return `${Math.round(value)}`
}

function formatStrike(strike: number): string {
    if (!Number.isFinite(strike)) return ''
    if (Number.isInteger(strike)) return String(strike)
    return strike.toFixed(2)
}
