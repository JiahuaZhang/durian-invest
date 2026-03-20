import type { Time } from 'lightweight-charts'

export type ChartMode = 'call' | 'put' | 'split' | 'overlay' | 'net'
export type MetricView = 'openInterest' | 'volume' | 'both'

export type StrikeMetrics = {
    strike: number
    callOpenInterest: number
    putOpenInterest: number
    callVolume: number
    putVolume: number
    totalOpenInterest: number
    totalVolume: number
}

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

export type MaxPainResult = {
    strike: number
    callValue: number
    putValue: number
    totalValue: number
}
