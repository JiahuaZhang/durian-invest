import { createChart, LineSeries, LineStyle } from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { SD, SMA, Stochastic } from 'technicalindicators'

export type RawPhysicalData = {
    id: string
    report_date_as_yyyy_mm_dd: string
    // Producer/Merchant/Processor/User
    prod_merc_positions_long: string
    prod_merc_positions_short: string
    // Swap Dealers
    swap_positions_long_all: string
    swap__positions_short_all: string // Note: double underscore in API
    // Managed Money
    m_money_positions_long_all: string
    m_money_positions_short_all: string
    // Other Reportables
    other_rept_positions_long: string
    other_rept_positions_short: string

    [key: string]: string
}

export type SeriesKey =
    | 'producers'
    | 'managedMoney'
    | 'swapDealers'
    | 'otherReportables'

export type ProcessedPoint = {
    time: string
    producers: number
    managedMoney: number
    swapDealers: number
    otherReportables: number
    producerIndex?: number
    managedMoneyIndex?: number
    producerZScore?: number
    managedMoneyZScore?: number
}

const seriesConfig = [
    { key: 'producers', label: 'Producers/Merchants', color: '#2563eb' }, // Blue (was Asset Managers)
    { key: 'managedMoney', label: 'Managed Money', color: '#16a34a' },   // Green (was Leveraged Funds)
    { key: 'swapDealers', label: 'Swap Dealers', color: '#dc2626' },     // Red (was Dealers)
    { key: 'otherReportables', label: 'Other Reportables', color: '#94a3b8' }
]

const calculateZScore = (values: number[], period: number) => {
    const sd = SD.calculate({ period, values })
    const sma = SMA.calculate({ period, values })
    const offset = period - 1

    return values.map((val, i) => {
        if (i < offset) return 0
        const index = i - offset
        const s = sd[index]
        const m = sma[index]
        return (s && s !== 0) ? (val - m) / s : 0
    })
}

export function processPhysicalData(data: RawPhysicalData[]): ProcessedPoint[] {
    const sortedRaw = data.slice().sort((a, b) => String(a.report_date_as_yyyy_mm_dd || '').localeCompare(String(b.report_date_as_yyyy_mm_dd || '')))

    const fn = (val: string) => Number(val ?? '0')

    const rawValues = sortedRaw.map(row => ({
        time: row.report_date_as_yyyy_mm_dd.split('T')[0],
        producers: fn(row.prod_merc_positions_long) - fn(row.prod_merc_positions_short),
        managedMoney: fn(row.m_money_positions_long_all) - fn(row.m_money_positions_short_all),
        swapDealers: fn(row.swap_positions_long_all) - fn(row.swap__positions_short_all),
        otherReportables: fn(row.other_rept_positions_long) - fn(row.other_rept_positions_short)
    }))

    // Calculate COT Index using Stochastic
    const period = 52

    const prodValues = rawValues.map(d => d.producers)
    const prodStoch = Stochastic.calculate({
        high: prodValues,
        low: prodValues,
        close: prodValues,
        period: period,
        signalPeriod: 3
    })
    const prodZScores = calculateZScore(prodValues, period)

    const mmValues = rawValues.map(d => d.managedMoney)
    const mmStoch = Stochastic.calculate({
        high: mmValues,
        low: mmValues,
        close: mmValues,
        period: period,
        signalPeriod: 3
    })
    const mmZScores = calculateZScore(mmValues, period)

    const resultOffset = period - 1

    return rawValues.map((point, i) => {
        let pIndex: number | undefined
        let mmIndex: number | undefined

        if (i >= resultOffset) {
            const indexInResult = i - resultOffset
            if (prodStoch[indexInResult]) pIndex = prodStoch[indexInResult].k
            if (mmStoch[indexInResult]) mmIndex = mmStoch[indexInResult].k
        }

        return {
            ...point,
            producerIndex: pIndex ?? 50,
            managedMoneyIndex: mmIndex ?? 50,
            producerZScore: prodZScores[i] ?? 0,
            managedMoneyZScore: mmZScores[i] ?? 0,
        }
    })
}

export function PhysicalTFFChart({ data }: { data: RawPhysicalData[] }) {
    const chartContainerRef = useRef<HTMLDivElement>(null)
    const processedData = processPhysicalData(data)
    const [legend, setLegend] = useState<any>(null)

    useEffect(() => {
        if (!chartContainerRef.current) return

        const chart = createChart(chartContainerRef.current, { rightPriceScale: { scaleMargins: { top: 0, bottom: 0.51 } } })

        const seriesMap = new Map<any, string>()

        seriesConfig.forEach(conf => {
            const series = chart.addSeries(LineSeries, {
                color: conf.color, lineWidth: 2, title: conf.label, priceScaleId: 'right', priceLineVisible: false
            })
            series.setData(processedData.map(d => ({ time: d.time, value: Number((d as any)[conf.key] ?? 0) })))
            seriesMap.set(series, conf.label)
        })

        const addIndexExtras = (scaleId: string, up = 90, down = 10) => {
            const top = chart.addSeries(LineSeries, { priceScaleId: scaleId, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
            const bot = chart.addSeries(LineSeries, { priceScaleId: scaleId, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
            top.setData(processedData.map(d => ({ time: d.time, value: up })))
            bot.setData(processedData.map(d => ({ time: d.time, value: down })))
        }

        const prodScaleId = 'prod-scale'
        const prodSeries = chart.addSeries(LineSeries, {
            priceScaleId: prodScaleId, color: '#2563eb', lineWidth: 2, title: 'Producer Index', priceLineVisible: false
        })
        chart.priceScale(prodScaleId).applyOptions({ scaleMargins: { top: 0.5, bottom: 0.375 } })
        prodSeries.setData(processedData.map(d => ({ time: d.time, value: d.producerIndex ?? 50 })))
        seriesMap.set(prodSeries, 'Prod Index')
        addIndexExtras(prodScaleId)

        const mmScaleId = 'mm-scale'
        const mmSeries = chart.addSeries(LineSeries, {
            priceScaleId: mmScaleId, color: '#16a34a', lineWidth: 2, title: 'Managed Money Index', priceLineVisible: false
        })
        mmSeries.setData(processedData.map(d => ({ time: d.time, value: d.managedMoneyIndex ?? 50 })))
        seriesMap.set(mmSeries, 'MM Index')

        chart.priceScale(mmScaleId).applyOptions({ scaleMargins: { top: 0.635, bottom: 0.25 } })
        addIndexExtras(mmScaleId)

        const prodZScaleId = 'prod-z-scale'
        const prodZSeries = chart.addSeries(LineSeries, {
            priceScaleId: prodZScaleId, color: '#60a5fa', lineWidth: 2, title: 'Producer Z-Score', priceLineVisible: false
        })
        prodZSeries.setData(processedData.map(d => ({ time: d.time, value: d.producerZScore ?? 0 })))
        seriesMap.set(prodZSeries, 'Prod Z-Score')
        chart.priceScale(prodZScaleId).applyOptions({ scaleMargins: { top: 0.76, bottom: 0.125 } })
        addIndexExtras(prodZScaleId, 2, -2)

        const mmZScaleId = 'mm-z-scale'
        const mmZSeries = chart.addSeries(LineSeries, {
            priceScaleId: mmZScaleId, color: '#4ade80', lineWidth: 2, title: 'Managed Money Z-Score', priceLineVisible: false
        })
        mmZSeries.setData(processedData.map(d => ({ time: d.time, value: d.managedMoneyZScore ?? 0 })))
        seriesMap.set(mmZSeries, 'MM Z-Score')

        chart.priceScale(mmZScaleId).applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } })
        addIndexExtras(mmZScaleId, 2, -2)

        chart.subscribeCrosshairMove((param) => {
            if (param.time && param.point) {
                const data: any = { date: param.time }
                param.seriesData.forEach((value, series) => {
                    const label = seriesMap.get(series)
                    if (label) {
                        data[label] = (value as any).value
                    }
                })
                setLegend(data)
            } else {
                setLegend(null)
            }
        })

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth })
            }
        }
        window.addEventListener('resize', handleResize)

        setTimeout(() => chart.timeScale().fitContent(), 0)

        return () => {
            window.removeEventListener('resize', handleResize)
            chart.remove()
        }
    }, [processedData])

    return (
        <div un-border="~ slate-200 rounded" un-shadow="sm" un-p="2">
            <div un-flex="~ gap-6 wrap justify-between" un-mb="2">
                <div un-flex="~ gap-3">
                    {seriesConfig.map((conf) => (
                        <div key={conf.key} un-flex="~ gap-1 items-center">
                            <div un-w="2" un-h="2" un-rounded="full" style={{ backgroundColor: conf.color }}></div>
                            <span un-text="xs" style={{ color: conf.color }}>{conf.label}</span>
                        </div>
                    ))}
                </div>

                <div un-flex="~ gap-3">
                    <div un-flex="~ items-center gap-1">
                        <div un-w="2" un-h="2" un-rounded="full" un-bg="blue-600"></div>
                        <span un-text="xs slate-600">Prod Index</span>
                    </div>
                    <div un-flex="~ items-center gap-1">
                        <div un-w="2" un-h="2" un-rounded="full" un-bg="blue-400"></div>
                        <span un-text="xs slate-600">Prod Z-Score</span>
                    </div>
                    <div un-flex="~ items-center gap-1">
                        <div un-w="2" un-h="2" un-rounded="full" un-bg="green-600"></div>
                        <span un-text="xs slate-600">MM Index</span>
                    </div>
                    <div un-flex="~ items-center gap-1">
                        <div un-w="2" un-h="2" un-rounded="full" un-bg="green-400"></div>
                        <span un-text="xs slate-600">MM Z-Score</span>
                    </div>
                </div>
            </div>

            <div un-position="relative" un-h="200" un-w="full">
                {legend && (
                    <div un-position="absolute top-2 left-2" un-z="10" un-p="2" un-bg='white' un-shadow="sm" un-border="~ slate-100 rounded" un-text="xs" un-font="mono">
                        <div un-text="slate-500 mb-1">{legend.date}</div>
                        {seriesConfig.map(conf => {
                            const val = legend[conf.label]
                            if (val === undefined) return null
                            return (
                                <div key={conf.key} un-flex="~ gap-2 justify-between">
                                    <span style={{ color: conf.color }}>{conf.label}:</span>
                                    <span>{val.toLocaleString()}</span>
                                </div>
                            )
                        })}
                        <div un-h="1px" un-bg="slate-100" un-my="1" />
                        {legend['Prod Index'] !== undefined && (
                            <div un-flex="~ gap-2 justify-between">
                                <span un-text="blue-600">Producers Index:</span>
                                <span>{legend['Prod Index'].toLocaleString()}</span>
                            </div>
                        )}
                        {legend['MM Index'] !== undefined && (
                            <div un-flex="~ gap-2 justify-between">
                                <span un-text="green-600">Managed Money Index:</span>
                                <span>{legend['MM Index'].toLocaleString()}</span>
                            </div>
                        )}
                        {legend['Prod Z-Score'] !== undefined && (
                            <div un-flex="~ gap-2 justify-between">
                                <span un-text="blue-400">Producers Z-Score:</span>
                                <span>{legend['Prod Z-Score'].toFixed(2)}</span>
                            </div>
                        )}
                        {legend['MM Z-Score'] !== undefined && (
                            <div un-flex="~ gap-2 justify-between">
                                <span un-text="green-400">Managed Money Z-Score:</span>
                                <span>{legend['MM Z-Score'].toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                )}
                <div ref={chartContainerRef} un-h="full" un-w="full" />
            </div>
        </div>
    )
}
