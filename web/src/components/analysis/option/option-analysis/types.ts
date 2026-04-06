import type { Time } from 'lightweight-charts'
import type { StrikeMetrics } from '@/utils/yahoo'

export type { GexPoint, MaxPainResult, StrikeMetrics, VolPoint } from '@/utils/yahoo'

export type ChartMode = 'call' | 'put' | 'split' | 'overlay' | 'net'
export type MetricView = 'openInterest' | 'volume' | 'both'

export type HistogramPoint = {
    time: Time
    value: number
    color: string
}

export type SlotDescriptor = {
    id: string
    getValue: (strike: StrikeMetrics) => number
    color?: string
    getColor?: (value: number) => string
    group?: number
}

export type ChartSeries = {
    id: string
    data: HistogramPoint[]
}
