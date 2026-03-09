import type { ChartMode, MetricView } from './types'

export const CHART_MODES: Array<{ value: ChartMode; label: string }> = [
    { value: 'call', label: 'Call' },
    { value: 'put', label: 'Put' },
    { value: 'split', label: 'Split' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'net', label: 'Net' },
]

export const METRIC_VIEWS: Array<{ value: MetricView; label: string }> = [
    { value: 'openInterest', label: 'Open Interest' },
    { value: 'volume', label: 'Volume' },
    { value: 'both', label: 'Both' },
]

export const COLORS = {
    callOpenInterest: '#7bf1a8',
    putOpenInterest: '#ffc9c9',
    callVolume: '#096',
    putVolume: '#e7000b',
}
