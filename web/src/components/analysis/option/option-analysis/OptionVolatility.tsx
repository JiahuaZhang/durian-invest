import type { YahooOption, YahooOptionChainEntry } from '@/utils/yahoo'
import { ColorType, createChart, LineSeries, LineStyle, type Time } from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { VertLine } from '../../chart/VerticalLine'
import { useCandleData, type CandleData } from '../../context/ChartDataContext'
import { formatStrike } from './utils'

type OptionVolatilityProps = {
    symbol: string
    chain: YahooOptionChainEntry | null
    spotPrice?: number
}

type VolatilityView = 'both' | 'call' | 'put'

type VolPoint = {
    strike: number
    iv: number
}

const VIEW_OPTIONS: Array<{ value: VolatilityView; label: string }> = [
    { value: 'both', label: 'Calls & Puts' },
    { value: 'call', label: 'Calls' },
    { value: 'put', label: 'Puts' },
]

const CALL_COLOR = '#0d9488'
const PUT_COLOR = '#ef4444'
const HISTORICAL_COLOR = '#334155'

export function OptionVolatility({ symbol, chain, spotPrice }: OptionVolatilityProps) {
    const [view, setView] = useState<VolatilityView>('both')
    const containerRef = useRef<HTMLDivElement>(null)
    const candleData = useCandleData()

    const skewData = useMemo(() => buildSkewData(chain), [chain])
    const historicalVolatility = useMemo(() => calculateHistoricalVolatility(candleData, 30), [candleData])
    const safeSpotPrice = typeof spotPrice === 'number' && Number.isFinite(spotPrice) ? spotPrice : null

    const visibleCalls = useMemo(() => (view === 'put' ? [] : skewData.callPoints), [view, skewData.callPoints])
    const visiblePuts = useMemo(() => (view === 'call' ? [] : skewData.putPoints), [view, skewData.putPoints])
    const hasSkewData = skewData.callPoints.length > 0 || skewData.putPoints.length > 0
    const hasVisibleData = visibleCalls.length > 0 || visiblePuts.length > 0

    const atmCall = useMemo(() => {
        if (safeSpotPrice == null) return null
        return findNearestPoint(skewData.callPoints, safeSpotPrice)
    }, [safeSpotPrice, skewData.callPoints])

    const atmPut = useMemo(() => {
        if (safeSpotPrice == null) return null
        return findNearestPoint(skewData.putPoints, safeSpotPrice)
    }, [safeSpotPrice, skewData.putPoints])

    useEffect(() => {
        if (!containerRef.current || (visibleCalls.length === 0 && visiblePuts.length === 0)) return

        const chart = createChart(containerRef.current, {
            height: 360,
            layout: {
                background: { type: ColorType.Solid, color: '#ffffff' },
                textColor: '#64748b',
                fontSize: 12,
            },
            grid: {
                vertLines: { color: '#e2e8f0' },
                horzLines: { color: '#e2e8f0' },
            },
            rightPriceScale: {
                borderVisible: false,
            },
            leftPriceScale: {
                visible: false,
            },
            timeScale: {
                borderVisible: false,
                minBarSpacing: 0.35,
                tickMarkFormatter: (time: Time) => formatStrike(Number(time)),
            },
            localization: {
                timeFormatter: (time: Time) => formatStrike(Number(time)),
                priceFormatter: (value: number) => `${value.toFixed(2)}%`,
            },
        })

        if (visibleCalls.length > 0) {
            const callSeries = chart.addSeries(LineSeries, {
                color: CALL_COLOR,
                lineWidth: 2,
                lastValueVisible: false,
                priceLineVisible: false,
            })

            callSeries.setData(
                visibleCalls.map(point => ({
                    time: point.strike as Time,
                    value: point.iv,
                })),
            )
        }

        if (visiblePuts.length > 0) {
            const putSeries = chart.addSeries(LineSeries, {
                color: PUT_COLOR,
                lineWidth: 2,
                lastValueVisible: false,
                priceLineVisible: false,
            })

            putSeries.setData(
                visiblePuts.map(point => ({
                    time: point.strike as Time,
                    value: point.iv,
                })),
            )
        }

        if (
            historicalVolatility != null
            && skewData.minStrike != null
            && skewData.maxStrike != null
        ) {
            const rightStrike = skewData.maxStrike === skewData.minStrike
                ? skewData.maxStrike + 0.01
                : skewData.maxStrike

            const historicalSeries = chart.addSeries(LineSeries, {
                color: HISTORICAL_COLOR,
                lineWidth: 2,
                lineStyle: LineStyle.Dashed,
                lastValueVisible: false,
                priceLineVisible: false,
                crosshairMarkerVisible: false,
            })

            historicalSeries.setData([
                { time: skewData.minStrike as Time, value: historicalVolatility },
                { time: rightStrike as Time, value: historicalVolatility },
            ])
        }

        if (safeSpotPrice != null && hasVisibleData) {
            // Use VertLine plugin attached to an invisible series to ensure it renders correctly
            const spotSeries = chart.addSeries(LineSeries, {
                visible: false,
                autoscaleInfoProvider: () => null,
            });
            spotSeries.setData([{ time: safeSpotPrice as Time, value: 0 }]);

            const vertLine = new VertLine(chart, spotSeries, safeSpotPrice as Time, {
                color: '#eab308',
                width: 2,
            });
            spotSeries.attachPrimitive(vertLine);
        }

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
    }, [historicalVolatility, skewData.maxStrike, skewData.minStrike, visibleCalls, visiblePuts, safeSpotPrice, hasVisibleData])

    if (!hasSkewData) {
        return (
            <section un-border="~ slate-200 rounded-lg" un-p="4" un-flex="~ col gap-2">
                <h3 un-text="lg slate-800" un-font="semibold">
                    Volatility Skew
                </h3>
                <p un-text="sm slate-500">
                    No implied volatility data found for {symbol}.
                </p>
            </section>
        )
    }

    return (
        <section un-border="~ slate-200 rounded-lg" un-p="4" un-flex="~ col gap-3">
            <header un-flex="~ justify-between items-center wrap gap-2">
                <div un-flex="~ col gap-1">
                    <h3 un-text="xl slate-900" un-font="bold">
                        Volatility Skew
                    </h3>
                </div>

                <div un-flex="~ gap-2 wrap">
                    {VIEW_OPTIONS.map(option => {
                        const active = view === option.value
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setView(option.value)}
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
            </header>

            {hasVisibleData ? (
                <div ref={containerRef} un-h="90" un-w="full" />
            ) : (
                <div un-border="~ amber-200 rounded-lg" un-bg="amber-50" un-p="3" un-text="sm amber-700">
                    No implied volatility values for the selected side.
                </div>
            )}

            <div un-flex="~ justify-between" un-text="xs slate-600">
                <div un-flex="~ gap-4" >
                    <span>
                        Spot: <strong>{safeSpotPrice == null ? '--' : formatStrike(safeSpotPrice)}</strong>
                    </span>
                    <span>
                        ATM Call IV: <strong un-text="teal-700">{formatVolatility(atmCall?.iv)}</strong>
                    </span>
                    <span>
                        ATM Put IV: <strong un-text="red-600">{formatVolatility(atmPut?.iv)}</strong>
                    </span>
                    <span>
                        30D HV: <strong un-text="slate-800">{formatVolatility(historicalVolatility)}</strong>
                    </span>
                </div>

                <div un-flex="~ gap-4">
                    {(view === 'both' || view === 'call') && (
                        <span un-flex="~ items-center gap-1">
                            <i un-inline-block un-w="2.5" un-h="0.5" style={{ backgroundColor: CALL_COLOR }} />
                            Calls IV
                        </span>
                    )}
                    {(view === 'both' || view === 'put') && (
                        <span un-flex="~ items-center gap-1">
                            <i un-inline-block un-w="2.5" un-h="0.5" style={{ backgroundColor: PUT_COLOR }} />
                            Puts IV
                        </span>
                    )}
                    <span un-flex="~ items-center gap-1">
                        <i un-inline-block un-w="2.5" un-h="0.5" style={{ backgroundColor: HISTORICAL_COLOR }} />
                        30D Historical Vol
                    </span>
                </div>
            </div>
        </section>
    )
}

function buildSkewData(chain: YahooOptionChainEntry | null): {
    callPoints: VolPoint[]
    putPoints: VolPoint[]
    minStrike: number | null
    maxStrike: number | null
} {
    const callPoints = buildVolatilityCurve(chain?.calls ?? [])
    const putPoints = buildVolatilityCurve(chain?.puts ?? [])
    const allPoints = [...callPoints, ...putPoints]

    if (allPoints.length === 0) {
        return {
            callPoints,
            putPoints,
            minStrike: null,
            maxStrike: null,
        }
    }

    const strikes = allPoints.map(point => point.strike)
    return {
        callPoints,
        putPoints,
        minStrike: Math.min(...strikes),
        maxStrike: Math.max(...strikes),
    }
}

function buildVolatilityCurve(options: YahooOption[]): VolPoint[] {
    const strikeMap = new Map<number, { sum: number; count: number }>()

    options.forEach(option => {
        if (!Number.isFinite(option.strike)) return
        if (!Number.isFinite(option.impliedVolatility) || option.impliedVolatility <= 0) return

        const existing = strikeMap.get(option.strike) ?? { sum: 0, count: 0 }
        existing.sum += option.impliedVolatility * 100
        existing.count += 1
        strikeMap.set(option.strike, existing)
    })

    return Array.from(strikeMap.entries())
        .map(([strike, entry]) => ({
            strike,
            iv: entry.sum / entry.count,
        }))
        .sort((a, b) => a.strike - b.strike)
}

function calculateHistoricalVolatility(candleData: CandleData[], lookbackDays: number): number | null {
    const closes = candleData
        .map(candle => candle.close)
        .filter((close): close is number => Number.isFinite(close) && close > 0)

    if (closes.length < 3) return null

    const sampleLength = Math.min(closes.length, lookbackDays + 1)
    const sampledCloses = closes.slice(-sampleLength)
    const returns: number[] = []

    for (let index = 1; index < sampledCloses.length; index += 1) {
        const previous = sampledCloses[index - 1]
        const current = sampledCloses[index]
        if (previous <= 0 || current <= 0) continue
        returns.push(Math.log(current / previous))
    }

    if (returns.length < 2) return null

    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    if (!Number.isFinite(variance) || variance < 0) return null

    const annualizedVolatility = Math.sqrt(variance) * Math.sqrt(252) * 100
    return Number.isFinite(annualizedVolatility) ? annualizedVolatility : null
}

function findNearestPoint(points: VolPoint[], strike: number): VolPoint | null {
    if (points.length === 0) return null

    let best = points[0]
    let bestDistance = Math.abs(points[0].strike - strike)

    for (let index = 1; index < points.length; index += 1) {
        const distance = Math.abs(points[index].strike - strike)
        if (distance < bestDistance) {
            best = points[index]
            bestDistance = distance
        }
    }

    return best
}

function formatVolatility(value: number | undefined | null): string {
    if (value == null || !Number.isFinite(value)) return '--'
    return `${value.toFixed(2)}%`
}
