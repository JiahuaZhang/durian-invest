import type { MaxPainResult } from '@/utils/yahoo'
import { ColorType, createChart, HistogramSeries, LineSeries, type Time } from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import { formatCompactNumber, formatExpirationDate, formatStrike } from './utils'

type Props = {
    maxPainCache: Map<number, MaxPainResult>
    spotPrice?: number
}

const MAX_PAIN_COLOR = '#7c3aed'
const SPOT_COLOR = '#eab308'
const PAYOUT_COLOR = '#94a3b8'

export function OptionMaxPainChart({ maxPainCache, spotPrice }: Props) {
    const containerRef = useRef<HTMLDivElement>(null)

    const entries = [...maxPainCache.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([date, result]) => ({ date, ...result }))

    useEffect(() => {
        if (!containerRef.current || entries.length === 0) return

        const chart = createChart(containerRef.current, {
            height: 280,
            leftPriceScale: {
                visible: true,
                borderVisible: true,
            },
            rightPriceScale: {
                visible: true,
                borderVisible: true,
            },
            timeScale: {
                borderVisible: false,
                tickMarkFormatter: (time: Time) => {
                    const d = new Date(Number(time) * 1000)
                    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
                },
            },
            localization: {
                timeFormatter: (time: Time) => formatExpirationDate(Number(time)),
            },
        })

        // Histogram: total payout (right scale)
        const payoutSeries = chart.addSeries(HistogramSeries, {
            priceScaleId: 'right',
            color: PAYOUT_COLOR,
            priceLineVisible: false,
            lastValueVisible: false,
        })
        payoutSeries.setData(
            entries.map(e => ({
                time: e.date as Time,
                value: e.totalValue,
                color: PAYOUT_COLOR,
            }))
        )

        // Line: max pain strike (left scale)
        const maxPainSeries = chart.addSeries(LineSeries, {
            priceScaleId: 'left',
            color: MAX_PAIN_COLOR,
            lineWidth: 2,
            pointMarkersVisible: true,
            lastValueVisible: false,
            priceLineVisible: false,
        })
        maxPainSeries.setData(
            entries.map(e => ({
                time: e.date as Time,
                value: e.strike,
            }))
        )

        // Line: spot price reference (left scale)
        if (spotPrice != null && entries.length >= 2) {
            const spotSeries = chart.addSeries(LineSeries, {
                priceScaleId: 'left',
                color: SPOT_COLOR,
                lineWidth: 1,
                lineStyle: 3, // dashed
                lastValueVisible: false,
                priceLineVisible: false,
                crosshairMarkerVisible: false,
            })
            spotSeries.setData([
                { time: entries[0].date as Time, value: spotPrice },
                { time: entries[entries.length - 1].date as Time, value: spotPrice },
            ])
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
    }, [entries.length, spotPrice])

    return (
        <div un-flex="~ col gap-2">
            <div ref={containerRef} un-w="full" />
            <div un-flex="~ gap-4 justify-end" un-text="xs slate-500">
                <span un-flex="~ items-center gap-1">
                    <i un-w="2.5" un-h="0.5" style={{ backgroundColor: MAX_PAIN_COLOR }} />
                    Max Pain Strike
                </span>
                <span un-flex="~ items-center gap-1">
                    <i un-w="2.5" un-h="0.5" style={{ backgroundColor: SPOT_COLOR }} />
                    Spot Price
                </span>
                <span un-flex="~ items-center gap-1">
                    <i un-w="2.5" un-h="2.5" un-rounded="sm" style={{ backgroundColor: PAYOUT_COLOR }} />
                    Total Payout
                </span>
            </div>
        </div>
    )
}

type TileProps = {
    maxPainCache: Map<number, MaxPainResult>
    spotPrice?: number
}

export function OptionMaxPainTiles({ maxPainCache, spotPrice }: TileProps) {
    return (
        <div un-flex="~ col gap-2">
            {[...maxPainCache.keys()].sort().map(key => {
                const maxPain = maxPainCache.get(key)
                if (!maxPain) return null
                const gap = maxPain.strike - (spotPrice ?? 0)
                return (
                    <div key={key} un-border="~ sky-200 rounded-lg" un-bg="sky-50" un-p="2" un-flex="~ col gap-1">
                        <p un-text="sm">
                            {formatExpirationDate(key, true)} Max Pain: <span un-font="bold">${formatStrike(maxPain.strike)}</span>
                        </p>
                        <div un-text="xs" un-flex="~ gap-4 wrap">
                            <span>Call Payout: <strong>${formatCompactNumber(maxPain.callValue)}</strong></span>
                            <span>Put Payout: <strong>${formatCompactNumber(maxPain.putValue)}</strong></span>
                            <span>Total Payout: <strong>${formatCompactNumber(maxPain.totalValue)}</strong></span>
                            <span>Gap vs spot: <strong>{gap > 0 ? '+' : ''}{gap.toFixed(2)}</strong></span>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
