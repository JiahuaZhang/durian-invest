import type { YahooOption, YahooOptionChainEntry } from '@/utils/yahoo'
import { ColorType, createChart, HistogramSeries, LineSeries, type Time } from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BackgroundZone } from '../../chart/BackgroundZone'
import { VertLine } from '../../chart/VerticalLine'
import { formatCompactNumber, formatStrike } from './utils'

type OptionGexProps = {
    chain: YahooOptionChainEntry | null
    spotPrice?: number
}

type GexPoint = {
    strike: number
    callGex: number
    putGex: number
    totalGex: number
}

type GammaZone = {
    start: number
    end: number
    isLong: boolean
}

type GexMode = 'overlay' | 'net'
type GexSource = 'openInterest' | 'volume'

const GEX_MODES: Array<{ value: GexMode; label: string }> = [
    { value: 'overlay', label: 'Call & Put' },
    { value: 'net', label: 'Net' },
]

const GEX_SOURCES: Array<{ value: GexSource; label: string }> = [
    { value: 'openInterest', label: 'Open Interest' },
    { value: 'volume', label: 'Volume' },
]

const CALL_GEX_COLOR = '#34d399'
const PUT_GEX_COLOR = '#f87171'
const NET_GEX_POSITIVE = '#16a34a'
const NET_GEX_NEGATIVE = '#dc2626'
const SPOT_COLOR = '#eab308'

const LONG_GAMMA_BG = 'rgba(74, 222, 128, 0.10)'
const SHORT_GAMMA_BG = 'rgba(248, 113, 113, 0.10)'

export function OptionGex({ chain, spotPrice }: OptionGexProps) {
    const [mode, setMode] = useState<GexMode>('overlay')
    const [gexSource, setGexSource] = useState<GexSource>('openInterest')
    const containerRef = useRef<HTMLDivElement>(null)

    const safeSpotPrice = typeof spotPrice === 'number' && Number.isFinite(spotPrice) ? spotPrice : null

    const gexData = useMemo(() => computeGexByStrike(chain, safeSpotPrice, gexSource), [chain, safeSpotPrice, gexSource])

    const gammaZones = useMemo(() => findGammaZones(gexData), [gexData])

    const totalNetGex = useMemo(
        () => gexData.reduce((sum, point) => sum + point.totalGex, 0),
        [gexData],
    )

    useEffect(() => {
        if (!containerRef.current || gexData.length === 0) return

        const chart = createChart(containerRef.current, {
            height: 360,
            layout: {
                background: { type: ColorType.Solid, color: '#ffffff' },
                textColor: '#64748b',
                fontSize: 12,
            },
            grid: {
                vertLines: { color: '#f1f5f9' },
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
                minBarSpacing: 0.2,
                tickMarkFormatter: (time: Time) => formatStrike(Number(time)),
            },
            localization: {
                priceFormatter: (value: number) => formatCompactNumber(value),
                timeFormatter: (time: Time) => formatStrike(Number(time)),
            },
        })

        if (mode === 'overlay') {
            // Call GEX (positive bars, green)
            const callSeries = chart.addSeries(HistogramSeries, {
                priceLineVisible: false,
                lastValueVisible: false,
            })
            callSeries.setData(
                gexData.map(point => ({
                    time: point.strike as Time,
                    value: point.callGex,
                    color: CALL_GEX_COLOR,
                })),
            )

            // Put GEX (negative bars, red)
            const putSeries = chart.addSeries(HistogramSeries, {
                priceLineVisible: false,
                lastValueVisible: false,
            })
            putSeries.setData(
                gexData.map(point => ({
                    time: point.strike as Time,
                    value: -point.putGex,
                    color: PUT_GEX_COLOR,
                })),
            )
        } else {
            // Net GEX (single series, colored by sign)
            const netSeries = chart.addSeries(HistogramSeries, {
                priceLineVisible: false,
                lastValueVisible: false,
            })
            netSeries.setData(
                gexData.map(point => ({
                    time: point.strike as Time,
                    value: point.totalGex,
                    color: point.totalGex >= 0 ? NET_GEX_POSITIVE : NET_GEX_NEGATIVE,
                })),
            )
        }

        // Spot price vertical line (yellow)
        if (safeSpotPrice != null) {
            const spotSeries = chart.addSeries(LineSeries, {
                visible: false,
                autoscaleInfoProvider: () => null,
            })
            spotSeries.setData([{ time: safeSpotPrice as Time, value: 0 }])

            const vertLine = new VertLine(chart, spotSeries, safeSpotPrice as Time, {
                color: SPOT_COLOR,
                width: 2,
            })
            spotSeries.attachPrimitive(vertLine)
        }

        // Background zones for long/short gamma areas
        for (const { start, end, isLong } of gammaZones) {
            const zoneSeries = chart.addSeries(LineSeries, {
                visible: false,
                autoscaleInfoProvider: () => null,
            })
            zoneSeries.setData([
                { time: start as Time, value: 0 },
                { time: end as Time, value: 0 },
            ])

            const zone = new BackgroundZone(
                chart,
                zoneSeries,
                start as Time,
                end as Time,
                { color: isLong ? LONG_GAMMA_BG : SHORT_GAMMA_BG },
            )
            zoneSeries.attachPrimitive(zone)
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
    }, [gexData, safeSpotPrice, gammaZones, mode, gexSource])

    if (gexData.length === 0) {
        return (
            <section un-border="~ slate-200 rounded-lg" un-p="4" un-flex="~ col gap-2">
                <h3 un-text="lg slate-800" un-font="semibold">
                    Gamma Exposure (GEX)
                </h3>
                <p un-text="sm slate-500">
                    No gamma exposure data available.
                </p>
            </section>
        )
    }

    return (
        <section un-border="~ slate-200 rounded-lg" un-p="4" un-flex="~ col gap-3">
            <header un-flex="~ justify-between">
                <h3 un-text="xl slate-900" un-font="bold">
                    Gamma Exposure (GEX)
                </h3>

                <div un-flex="~ gap-2">
                    <div un-flex="~ gap-2">
                        {GEX_MODES.map(option => {
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
                        {GEX_SOURCES.map(option => {
                            const active = gexSource === option.value
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setGexSource(option.value)}
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

            </header>

            <div key={`${mode}-${gexSource}`} ref={containerRef} un-w="full" un-h="88" />

            <div un-flex="~ justify-between wrap" un-text="xs slate-600">
                <div un-flex="~ gap-4">
                    <span>
                        Net GEX: <strong un-text={totalNetGex >= 0 ? 'green-700' : 'red-700'}>
                            {totalNetGex >= 0 ? '+' : ''}{formatCompactNumber(Math.round(totalNetGex))}
                        </strong>
                    </span>
                    {gammaZones.length > 1 && (
                        <span>
                            Flip Point{gammaZones.length > 2 ? 's' : ''}:{' '}
                            <strong un-text="purple-700">
                                {gammaZones.slice(1).map(z => formatStrike(z.start)).join(', ')}
                            </strong>
                        </span>
                    )}
                </div>

                <div un-flex="~ gap-4">
                    {mode === 'overlay' ? (
                        <>
                            <span un-flex="~ items-center gap-1">
                                <i un-w="2.5" un-h="2.5" un-rounded="sm" style={{ backgroundColor: CALL_GEX_COLOR }} />
                                Call GEX
                            </span>
                            <span un-flex="~ items-center gap-1">
                                <i un-w="2.5" un-h="2.5" un-rounded="sm" style={{ backgroundColor: PUT_GEX_COLOR }} />
                                Put GEX
                            </span>
                        </>
                    ) : (
                        <>
                            <span un-flex="~ items-center gap-1">
                                <i un-w="2.5" un-h="2.5" un-rounded="sm" style={{ backgroundColor: NET_GEX_POSITIVE }} />
                                Positive GEX
                            </span>
                            <span un-flex="~ items-center gap-1">
                                <i un-w="2.5" un-h="2.5" un-rounded="sm" style={{ backgroundColor: NET_GEX_NEGATIVE }} />
                                Negative GEX
                            </span>
                        </>
                    )}
                    <span un-flex="~ items-center gap-1">
                        <i un-w="0.5" un-h="2.5" style={{ backgroundColor: SPOT_COLOR }} />
                        Spot
                    </span>
                    <span un-flex="~ items-center gap-1">
                        <i un-w="2.5" un-h="2.5" un-rounded="sm" style={{ backgroundColor: LONG_GAMMA_BG }} />
                        Long Gamma
                    </span>
                    <span un-flex="~ items-center gap-1">
                        <i un-w="2.5" un-h="2.5" un-rounded="sm" style={{ backgroundColor: SHORT_GAMMA_BG }} />
                        Short Gamma
                    </span>
                </div>
            </div>
        </section>
    )
}

// ============================================================================
// GEX Computation
// ============================================================================

function calculateGamma(
    S: number,
    K: number,
    T: number,
    sigma: number,
    r = 0.05,
): number {
    if (T <= 0 || sigma === 0 || S === 0) return 0

    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
    const nd1 = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * d1 * d1)

    return nd1 / (S * sigma * Math.sqrt(T))
}

function computeGexByStrike(chain: YahooOptionChainEntry | null, spotPrice: number | null, source: GexSource = 'openInterest'): GexPoint[] {
    if (!chain || spotPrice == null || spotPrice <= 0) return []

    const now = Date.now() / 1000
    const strikeMap = new Map<number, { callGex: number; putGex: number }>()

    const processOption = (option: YahooOption, isCall: boolean) => {
        const weight = (source === 'volume' ? option.volume : option.openInterest) ?? 0
        if (weight <= 0) return

        const iv = option.impliedVolatility ?? 0
        if (iv <= 0) return

        const dt = new Date(option.expiration * 1000)
        const isEDT = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            timeZoneName: 'short',
        }).format(dt).includes('EDT')

        const utcMidnight = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) / 1000
        const offsetHours = isEDT ? 4 : 5
        const preciseExpiration = utcMidnight + (16 + offsetHours) * 3600

        const T = (preciseExpiration - now) / (365 * 24 * 3600)
        if (T <= 0) return

        const gamma = calculateGamma(spotPrice, option.strike, T, iv)
        const gexValue = gamma * weight * 100 * spotPrice

        const existing = strikeMap.get(option.strike) ?? { callGex: 0, putGex: 0 }
        if (isCall) {
            existing.callGex += gexValue
        } else {
            existing.putGex += gexValue
        }
        strikeMap.set(option.strike, existing)
    }

    chain.calls.forEach(option => processOption(option, true))
    chain.puts.forEach(option => processOption(option, false))

    return Array.from(strikeMap.entries())
        .map(([strike, data]) => ({
            strike,
            callGex: data.callGex,
            putGex: data.putGex,
            totalGex: data.callGex - data.putGex,
        }))
        .sort((a, b) => a.strike - b.strike)
}

function findGammaZones(gexData: GexPoint[]): GammaZone[] {
    if (gexData.length === 0) return []

    const flips: number[] = []
    for (let i = 1; i < gexData.length; i++) {
        const prev = gexData[i - 1].totalGex
        const curr = gexData[i].totalGex
        if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) {
            const prevStrike = gexData[i - 1].strike
            const currStrike = gexData[i].strike
            const ratio = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr))
            flips.push(Math.round((prevStrike + ratio * (currStrike - prevStrike)) * 100) / 100)
        }
    }

    const boundaries = [gexData[0].strike, ...flips, gexData[gexData.length - 1].strike]
    const zones: GammaZone[] = []

    for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i]
        const end = boundaries[i + 1]
        const mid = (start + end) / 2
        const closest = gexData.reduce((prev, curr) =>
            Math.abs(curr.strike - mid) < Math.abs(prev.strike - mid) ? curr : prev
        )
        zones.push({ start, end, isLong: closest.totalGex >= 0 })
    }

    return zones
}
