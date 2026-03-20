import { createChart, HistogramSeries, type Time } from 'lightweight-charts'
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
            grid: {
                vertLines: { color: '#f1f5f9' },
                horzLines: { color: '#f1f5f9' },
            },
            rightPriceScale: {
                borderVisible: false,
            },
            timeScale: {
                borderVisible: false,
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

const createSlot = (type: 'call' | 'put', side: 'up' | 'down', field: 'oi' | 'vol', group = 0): SlotDescriptor => {
    const sign = side === 'up' ? 1 : -1
    return {
        id: `${type}-${side}-${field}`,
        getValue: strike => sign * (type === 'call' ? (field === 'oi' ? strike.callOpenInterest : strike.callVolume) : (field === 'oi' ? strike.putOpenInterest : strike.putVolume)),
        color: type === 'call' ? (field === 'oi' ? COLORS.callOpenInterest : COLORS.callVolume) : (field === 'oi' ? COLORS.putOpenInterest : COLORS.putVolume),
        group,
    }
}

function buildChartSeries(
    strikes: StrikeMetrics[],
    mode: ChartMode,
    metricView: MetricView,
): { series: ChartSeries[]; tickLabels: Map<number, string> } {
    const includeOpenInterest = metricView === 'openInterest' || metricView === 'both'
    const includeVolume = metricView === 'volume' || metricView === 'both'

    const slots: SlotDescriptor[] = []

    if (mode === 'call') {
        if (includeOpenInterest && includeVolume) {
            slots.push(createSlot('call', 'up', 'oi', 0))
            slots.push(createSlot('call', 'down', 'vol', 0))
        } else if (includeOpenInterest) {
            slots.push(createSlot('call', 'up', 'oi'))
        } else if (includeVolume) {
            slots.push(createSlot('call', 'up', 'vol'))
        }
    } else if (mode === 'put') {
        if (includeOpenInterest && includeVolume) {
            slots.push(createSlot('put', 'up', 'oi', 0))
            slots.push(createSlot('put', 'down', 'vol', 0))
        } else if (includeOpenInterest) {
            slots.push(createSlot('put', 'up', 'oi'))
        } else if (includeVolume) {
            slots.push(createSlot('put', 'up', 'vol'))
        }
    } else if (mode === 'overlay') {
        if (includeOpenInterest) {
            slots.push(createSlot('put', 'up', 'oi'))
            slots.push(createSlot('call', 'up', 'oi', 1))
        }
        if (includeVolume) {
            slots.push(createSlot('put', 'up', 'vol', 2))
            slots.push(createSlot('call', 'up', 'vol', 3))
        }
    } else if (mode === 'split') {
        if (includeOpenInterest) {
            slots.push(createSlot('put', 'down', 'oi'))
            slots.push(createSlot('call', 'up', 'oi'))
        }

        if (includeVolume) {
            slots.push(createSlot('put', 'down', 'vol', 1))
            slots.push(createSlot('call', 'up', 'vol', 1))
        }
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
    const uniqueGroups = new Set(slots.map(s => s.group ?? s.id))
    const groupKeys = [...uniqueGroups]
    const laneStep = groupKeys.length > 1 ? Math.max(minGap * 0.12, 0.03) : 0

    const series = slots.map((slot) => {
        const groupKey = slot.group ?? slot.id
        const groupIndex = groupKeys.indexOf(groupKey)
        const offset = laneStep * (groupIndex - (groupKeys.length - 1) / 2)
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
