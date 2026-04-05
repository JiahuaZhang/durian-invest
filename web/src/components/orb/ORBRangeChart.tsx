import { useEffect, useRef } from 'react'
import { CandlestickSeries, createChart, LineSeries } from 'lightweight-charts'
import type { ORBOpeningRange } from '../../data/orb'

type Props = {
    range: ORBOpeningRange
    entryPrice?: number
    exitPrice?: number
}

export function ORBRangeChart({ range, entryPrice, exitPrice }: Props) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!containerRef.current || !range.bars_json?.length) return

        const chart = createChart(containerRef.current, {
            height: 200,
            timeScale: { timeVisible: true, secondsVisible: false },
        })

        const candleSeries = chart.addSeries(CandlestickSeries)
        const barData = range.bars_json.map(b => ({
            time: Math.floor(new Date(b.time).getTime() / 1000) as any,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
        }))
        candleSeries.setData(barData)

        // Range high/low lines
        const highLine = chart.addSeries(LineSeries, {
            color: '#26a69a',
            lineWidth: 1,
            lineStyle: 2, // dashed
            priceLineVisible: false,
            lastValueVisible: false,
        })
        highLine.setData(barData.map(b => ({ time: b.time, value: range.high })))

        const lowLine = chart.addSeries(LineSeries, {
            color: '#ef5350',
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
        })
        lowLine.setData(barData.map(b => ({ time: b.time, value: range.low })))

        chart.timeScale().fitContent()

        return () => chart.remove()
    }, [range, entryPrice, exitPrice])

    return <div ref={containerRef} un-w="full" un-rounded="lg" un-overflow="hidden" />
}
