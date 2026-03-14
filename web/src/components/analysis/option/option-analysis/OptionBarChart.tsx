import { ColorType, createChart, HistogramSeries, type Time } from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import { COLORS } from './constants'
import type { ChartMode, ChartSeries, MetricView, SlotDescriptor, StrikeMetrics } from './types'
import { findTickLabel, formatCompactNumber, formatStrike } from './utils'

type OptionBarChartProps = {
    strikes: StrikeMetrics[]
    mode: ChartMode
    metricView: MetricView
}

export function OptionBarChart({ strikes, mode, metricView }: OptionBarChartProps) {
    const containerRef = useRef<HTMLDivElement>(null)

    const chartData = buildChartSeries(strikes, mode, metricView)

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

function buildChartSeries(
    strikes: StrikeMetrics[],
    mode: ChartMode,
    metricView: MetricView,
): { series: ChartSeries[]; tickLabels: Map<number, string> } {
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
