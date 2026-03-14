import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CandlestickSeries, createChart, LineSeries } from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { calculateDistributionStats, normalPdf } from '../utils/statistics'
import { getHistoricalData, type OHLCData } from '../utils/yahoo-history'

type SearchParams = { symbol?: string }

export const Route = createFileRoute('/history')({
    validateSearch: (search: Record<string, unknown>): SearchParams => ({
        symbol: (search.symbol as string) || '^SPX'
    }),
    loaderDeps: ({ search }) => ({ symbol: search.symbol }),
    loader: async ({ deps }) => {
        const symbol = deps.symbol || '^SPX'
        const data = await getHistoricalData({ data: symbol })
        return { symbol, data: data ?? [] }
    },
    component: HistoryPage,
    errorComponent: ({ error }) => (
        <div un-p="8" un-text="center">
            <h2 un-text="xl" un-font="bold" un-text-color="red-600">Failed to load data</h2>
            <p un-text="slate-600" un-mt="2">{error.message}</p>
            <button
                onClick={() => window.location.reload()}
                un-mt="4" un-bg="blue-600" un-text="white" un-p="x-4 y-2" un-border="rounded" un-cursor="pointer"
            >
                Reload Page
            </button>
        </div>
    )
})

type DailyChange = {
    date: string
    changeAmount: number
    changePercent: number
    close: number
}

function computeDailyChanges(data: OHLCData[]): DailyChange[] {
    const changes: DailyChange[] = []
    for (let i = 1; i < data.length; i++) {
        const prevClose = data[i - 1].close
        const currClose = data[i].close
        const changeAmount = currClose - prevClose
        const changePercent = (changeAmount / prevClose) * 100
        changes.push({
            date: data[i].date,
            changeAmount,
            changePercent,
            close: currClose
        })
    }
    return changes
}

function findOutliers(changes: DailyChange[], threshold: number): DailyChange[] {
    return changes
        .filter(c => Math.abs(c.changePercent) >= threshold)
        .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
}

function getConfidenceLabel(zScore: number): string {
    const erf = (x: number): number => {
        const t = 1 / (1 + 0.5 * Math.abs(x))
        const tau = t * Math.exp(-x * x - 1.26551223 +
            t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
                t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
                    t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
        return x >= 0 ? 1 - tau : tau - 1
    }

    const absZ = Math.abs(zScore)
    const confidence = erf(absZ / Math.sqrt(2)) * 100
    return `${confidence.toFixed(0)}%`
}

function HistoryPage() {
    const { symbol, data } = Route.useLoaderData()
    const { symbol: searchSymbol } = Route.useSearch()
    const navigate = useNavigate()
    const [inputSymbol, setInputSymbol] = useState(searchSymbol || '^SPX')
    const [todayChange, setTodayChange] = useState('')

    const dailyChanges = computeDailyChanges(data)
    const changeValues = dailyChanges.map(d => d.changePercent)

    const stats = calculateDistributionStats(changeValues)

    const outliers3 = findOutliers(dailyChanges, 3)
    const outliers5 = findOutliers(dailyChanges, 5)

    const lastDayStats = (() => {
        if (dailyChanges.length === 0) return null
        const lastDay = dailyChanges[dailyChanges.length - 1]
        const zScore = stats.stdDev !== 0 ? (lastDay.changePercent - stats.mean) / stats.stdDev : 0
        return {
            date: lastDay.date,
            changeAmount: lastDay.changeAmount,
            changePercent: lastDay.changePercent,
            zScore
        }
    })()

    const upDownRatio = (() => {
        const upDays = changeValues.filter(v => v > 0).length
        const downDays = changeValues.filter(v => v < 0).length
        const flatDays = changeValues.filter(v => v === 0).length
        const upPercent = (upDays / changeValues.length) * 100
        return { upDays, downDays, flatDays, upPercent }
    })()

    const todayZScore = (() => {
        const val = parseFloat(todayChange)
        if (isNaN(val) || stats.stdDev === 0) return null
        return (val - stats.mean) / stats.stdDev
    })()

    const handleSymbolSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        navigate({ to: '/history', search: { symbol: inputSymbol } })
    }

    return (
        <div un-p="4" un-flex="~ col" un-gap="2">
            <div un-flex="~ justify-between items-center wrap gap-4">
                <h1 un-text="2xl" un-font="bold" un-text-color="slate-800">
                    {symbol}
                </h1>
                <form onSubmit={handleSymbolSubmit} un-flex="~ gap-2">
                    <input
                        type="text"
                        value={inputSymbol}
                        onChange={e => setInputSymbol(e.target.value)}
                        placeholder="Symbol (e.g., AAPL)"
                        un-border="~ slate-300 rounded"
                        un-p="x-3 y-2"
                        un-text="sm"
                        un-w="40"
                    />
                    <button
                        type="submit"
                        un-bg="blue-600 hover:blue-700"
                        un-text="white sm"
                        un-p="x-4 y-2"
                        un-border="rounded"
                        un-cursor="pointer"
                    >
                        Load
                    </button>
                </form>
            </div>

            <div un-border="~ slate-200 rounded-xl" un-shadow="sm" un-p="4">
                <CandlestickChart data={data} />
            </div>

            <div un-grid="~ cols-2 md:cols-4 lg:cols-6" un-gap="4">
                <StatCard label="Mean Daily Change" value={`${stats.mean.toFixed(3)}%`} />
                <StatCard label="Std Deviation" value={`${stats.stdDev.toFixed(3)}%`} />
                <StatCard label="Skewness" value={stats.skewness.toFixed(3)} />
                <StatCard label="Min Change" value={`${stats.min.toFixed(2)}%`} color="red-600" />
                <StatCard label="Max Change" value={`${stats.max.toFixed(2)}%`} color="green-600" />
                <StatCard label="Trading Days" value={stats.count.toString()} />
            </div>

            <div un-border="~ slate-200 rounded-xl" un-shadow="sm" un-p="4">
                <h2 un-text="lg" un-font="semibold" un-text-color="slate-700" un-mb="3">
                    Daily Change % Distribution (Normal Curve)
                </h2>
                <DistributionChart changeValues={changeValues} mean={stats.mean} stdDev={stats.stdDev} />
            </div>

            <div un-border="~ slate-200 rounded-xl" un-p="3" un-flex="~ items-center justify-between gap-4 wrap">
                <div un-flex="~ items-center gap-2">
                    <span un-text="sm slate-500">📈</span>
                    <span un-text="lg green-600" un-font="bold">↑{upDownRatio.upDays}</span>
                    <span un-text="slate-400">:</span>
                    <span un-text="lg red-600" un-font="bold">{upDownRatio.downDays}↓</span>
                    <span un-text="sm slate-500">({upDownRatio.upPercent.toFixed(1)}%)</span>
                </div>


                {lastDayStats && (
                    <div un-flex="~ items-center gap-2">
                        <span un-text="xs slate-500">{lastDayStats.date}:</span>
                        <span un-text="lg" un-font="bold" un-text-color={lastDayStats.changePercent >= 0 ? 'green-600' : 'red-600'}>
                            {lastDayStats.changePercent >= 0 ? '+' : ''}{lastDayStats.changeAmount.toFixed(2)}
                        </span>
                        <span un-text="sm" un-text-color={lastDayStats.changePercent >= 0 ? 'green-600' : 'red-600'}>
                            ({lastDayStats.changePercent >= 0 ? '+' : ''}{lastDayStats.changePercent.toFixed(2)}%)
                        </span>
                        <span un-text="sm blue-700" un-font="medium">{lastDayStats.zScore >= 0 ? '+' : ''}{lastDayStats.zScore.toFixed(2)}σ</span>
                        <span un-text="xs slate-400">({getConfidenceLabel(lastDayStats.zScore)})</span>
                    </div>
                )}

                <div un-flex="~ items-center gap-2">
                    <input
                        type="number"
                        step="0.01"
                        value={todayChange}
                        onChange={e => setTodayChange(e.target.value)}
                        placeholder="Custom %"
                        un-border="~ slate-300 rounded"
                        un-p="x-2 y-1"
                        un-text="sm"
                        un-w="30"
                    />
                    {todayZScore !== null && (
                        <>
                            <span un-text="sm blue-700" un-font="bold">→ {todayZScore >= 0 ? '+' : ''}{todayZScore.toFixed(2)}σ</span>
                            <span un-text="xs slate-400">({getConfidenceLabel(todayZScore)})</span>
                        </>
                    )}
                </div>
            </div>

            <div un-grid="~ cols-1 lg:cols-2" un-gap="4">
                <OutliersTable title="Extreme Days (≥3% move)" outliers={outliers3} />
                <OutliersTable title="Rare Days (≥5% move)" outliers={outliers5} />
            </div>
        </div>
    )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div un-border="~ slate-200 rounded-xl" un-p="4" un-shadow="sm">
            <div un-text="xs slate-500" un-font="medium">{label}</div>
            <div un-text={`xl ${color || 'slate-800'}`} un-font="bold" un-mt="1">{value}</div>
        </div>
    )
}

function CandlestickChart({ data }: { data: OHLCData[] }) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!containerRef.current) return

        const chart = createChart(containerRef.current, { height: 400 })

        const candleSeries = chart.addSeries(CandlestickSeries)

        candleSeries.setData(data.map(d => ({
            time: d.date,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close
        })))

        chart.timeScale().fitContent()

        const handleResize = () => {
            if (containerRef.current) {
                chart.applyOptions({ width: containerRef.current.clientWidth })
            }
        }
        window.addEventListener('resize', handleResize)

        return () => {
            window.removeEventListener('resize', handleResize)
            chart.remove()
        }
    }, [data])

    return <div ref={containerRef} />
}

function DistributionChart({ changeValues, mean, stdDev }: { changeValues: number[]; mean: number; stdDev: number }) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!containerRef.current || changeValues.length === 0) return

        const chart = createChart(containerRef.current, {
            height: 300,
            timeScale: {
                tickMarkFormatter: (time: number) => `${time.toFixed(1)}%`
            },
            localization: {
                timeFormatter: (time: number) => `${time.toFixed(2)}%`
            }
        })

        // Create histogram data
        const binWidth = 0.25
        const minBin = Math.floor(Math.min(...changeValues) / binWidth) * binWidth
        const maxBin = Math.ceil(Math.max(...changeValues) / binWidth) * binWidth
        const bins = new Map<number, number>()

        for (let b = minBin; b <= maxBin; b += binWidth) {
            bins.set(Math.round(b * 100) / 100, 0)
        }

        changeValues.forEach(v => {
            const bin = Math.round(Math.floor(v / binWidth) * binWidth * 100) / 100
            bins.set(bin, (bins.get(bin) || 0) + 1)
        })

        const histogramData = Array.from(bins.entries())
            .map(([x, count]) => ({ time: x as unknown as any, value: count }))
            .sort((a, b) => (a.time as number) - (b.time as number))

        const histSeries = chart.addSeries(LineSeries, {
            color: '#6366f1',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false
        })
        histSeries.setData(histogramData)

        // Overlay normal curve (scaled)
        const maxCount = Math.max(...Array.from(bins.values()))
        const normalData: { time: any; value: number }[] = []
        for (let x = minBin; x <= maxBin; x += binWidth / 2) {
            const pdfVal = normalPdf(x, mean, stdDev)
            const scaledVal = pdfVal * maxCount * stdDev * Math.sqrt(2 * Math.PI) * 0.8
            normalData.push({ time: x as unknown as any, value: scaledVal })
        }

        const normalSeries = chart.addSeries(LineSeries, {
            color: '#f59e0b',
            lineWidth: 2,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false
        })
        normalSeries.setData(normalData)

        chart.timeScale().fitContent()

        const handleResize = () => {
            if (containerRef.current) {
                chart.applyOptions({ width: containerRef.current.clientWidth })
            }
        }
        window.addEventListener('resize', handleResize)

        return () => {
            window.removeEventListener('resize', handleResize)
            chart.remove()
        }
    }, [changeValues, mean, stdDev])

    return (
        <div>
            <div ref={containerRef} un-w="full" />
            <div un-flex="~ gap-6 justify-center" un-mt="2">
                <div un-flex="~ items-center gap-2">
                    <div un-w="4" un-h="0.5" un-bg="indigo-500" />
                    <span un-text="xs slate-600">Actual Distribution</span>
                </div>
                <div un-flex="~ items-center gap-2">
                    <div un-w="4" un-h="0.5" un-bg="amber-500" un-border="dashed" />
                    <span un-text="xs slate-600">Normal Curve (fitted)</span>
                </div>
            </div>
        </div>
    )
}

function OutliersTable({ title, outliers }: { title: string; outliers: DailyChange[] }) {
    return (
        <div un-border="~ slate-200 rounded-xl" un-shadow="sm" un-p="4">
            <h3 un-font="semibold" un-text-color="slate-700" un-mb="3">{title}</h3>
            {outliers.length === 0 ? (
                <p un-text="sm slate-400">No outliers in this threshold.</p>
            ) : (
                <div un-max-h="64" un-overflow-y="auto">
                    <table un-w="full" un-text="sm">
                        <thead un-bg="slate-50">
                            <tr>
                                <th un-text="left slate-600" un-p="2">Date</th>
                                <th un-text="right slate-600" un-p="2">Change</th>
                                <th un-text="right slate-600" un-p="2">Change %</th>
                                <th un-text="right slate-600" un-p="2">Close</th>
                            </tr>
                        </thead>
                        <tbody>
                            {outliers.slice(0, 20).map(o => (
                                <tr key={o.date} un-border="b slate-100">
                                    <td un-p="2" un-font="mono">{o.date}</td>
                                    <td un-p="2" un-text="right" un-font="mono">
                                        <span un-text-color={o.changePercent >= 0 ? 'green-600' : 'red-600'}>
                                            {o.changePercent >= 0 ? '+' : ''}{o.changeAmount.toFixed(2)}
                                        </span>
                                    </td>
                                    <td un-p="2" un-text="right" un-font="mono">
                                        <span un-text-color={o.changePercent >= 0 ? 'green-600' : 'red-600'}>
                                            {o.changePercent >= 0 ? '+' : ''}{o.changePercent.toFixed(2)}%
                                        </span>
                                    </td>
                                    <td un-p="2" un-text="right slate-600" un-font="mono">
                                        ${o.close.toFixed(2)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {outliers.length > 20 && (
                        <p un-text="xs slate-400" un-mt="2">
                            Showing 20 of {outliers.length} outliers
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
