import { createChart, LineSeries, LineStyle } from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { SD, SMA, Stochastic } from 'technicalindicators'

export type RawTFFData = {
    id: string
    market_and_exchange_names: string
    report_date_as_yyyy_mm_dd: string
    yyyy_report_week_ww: string
    contract_market_name: string
    cftc_contract_market_code: string
    cftc_market_code: string
    cftc_region_code: string
    cftc_commodity_code: string
    commodity_name: string
    open_interest_all: string
    dealer_positions_long_all: string
    dealer_positions_short_all: string
    dealer_positions_spread_all: string
    asset_mgr_positions_long: string
    asset_mgr_positions_short: string
    asset_mgr_positions_spread: string
    lev_money_positions_long: string
    lev_money_positions_short: string
    lev_money_positions_spread: string
    other_rept_positions_long: string
    other_rept_positions_short: string
    other_rept_positions_spread: string
    tot_rept_positions_long_all: string
    tot_rept_positions_short: string
    nonrept_positions_long_all: string
    nonrept_positions_short_all: string
    pct_of_open_interest_all: string
    pct_of_oi_dealer_long_all: string
    pct_of_oi_dealer_short_all: string
    pct_of_oi_dealer_spread_all: string
    pct_of_oi_asset_mgr_long: string
    pct_of_oi_asset_mgr_short: string
    pct_of_oi_asset_mgr_spread: string
    pct_of_oi_lev_money_long: string
    pct_of_oi_lev_money_short: string
    pct_of_oi_lev_money_spread: string
    pct_of_oi_other_rept_long: string
    pct_of_oi_other_rept_short: string
    pct_of_oi_other_rept_spread: string
    pct_of_oi_tot_rept_long_all: string
    pct_of_oi_tot_rept_short: string
    pct_of_oi_nonrept_long_all: string
    pct_of_oi_nonrept_short_all: string
    traders_tot_all: string
    traders_dealer_long_all: string
    traders_dealer_short_all: string
    traders_dealer_spread_all: string
    traders_asset_mgr_long_all: string
    traders_asset_mgr_short_all: string
    traders_asset_mgr_spread: string
    traders_lev_money_long_all: string
    traders_lev_money_short_all: string
    traders_lev_money_spread: string
    traders_other_rept_long_all: string
    traders_other_rept_short: string
    traders_other_rept_spread: string
    traders_tot_rept_long_all: string
    traders_tot_rept_short_all: string
    conc_gross_le_4_tdr_long: string
    conc_gross_le_4_tdr_short: string
    conc_gross_le_8_tdr_long: string
    conc_gross_le_8_tdr_short: string
    conc_net_le_4_tdr_long_all: string
    conc_net_le_4_tdr_short_all: string
    conc_net_le_8_tdr_long_all: string
    conc_net_le_8_tdr_short_all: string
    contract_units: string
    cftc_subgroup_code: string
    commodity: string
    commodity_subgroup_name: string
    commodity_group_name: string
    futonly_or_combined: string
    [key: string]: string
}

export type SeriesKey =
    | 'assetManagers'
    | 'leveragedFunds'
    | 'dealers'
    | 'otherReportables'
    | 'commercials'
    | 'nonCommercials'

export type ProcessedPoint = {
    time: string
    assetManagers: number
    leveragedFunds: number
    dealers: number
    otherReportables: number
    assetManagerIndex?: number
    leveragedFundIndex?: number
    assetManagerZScore?: number
    leveragedFundZScore?: number
}

const seriesConfig = [
    { key: 'assetManagers', label: 'Asset Managers', color: '#2563eb' },
    { key: 'leveragedFunds', label: 'Leveraged Funds', color: '#16a34a' },
    { key: 'dealers', label: 'Dealers', color: '#dc2626' },
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

export function processTFFData(data: RawTFFData[]): ProcessedPoint[] {
    const sortedRaw = data.slice().sort((a, b) => String(a.report_date_as_yyyy_mm_dd || '').localeCompare(String(b.report_date_as_yyyy_mm_dd || '')))

    const fn = (val: string) => Number(val ?? '0')

    const rawValues = sortedRaw.map(row => ({
        time: row.report_date_as_yyyy_mm_dd.split('T')[0],
        assetManagers: fn(row.asset_mgr_positions_long) - fn(row.asset_mgr_positions_short),
        leveragedFunds: fn(row.lev_money_positions_long) - fn(row.lev_money_positions_short),
        dealers: fn(row.dealer_positions_long_all) - fn(row.dealer_positions_short_all),
        otherReportables: fn(row.other_rept_positions_long_all) - fn(row.other_rept_positions_short_all)
    }))

    // Calculate COT Index using Stochastic (Williams %R logic but 0-100)
    // Stochastic (raw %K) = (Close - Lowest Low) / (Highest High - Lowest Low) * 100
    // We pass the single series as High, Low, and Close.
    const period = 52

    const amValues = rawValues.map(d => d.assetManagers)
    const amStoch = Stochastic.calculate({
        high: amValues,
        low: amValues,
        close: amValues,
        period: period,
        signalPeriod: 3
    })
    const amZScores = calculateZScore(amValues, period)

    const lfValues = rawValues.map(d => d.leveragedFunds)
    const lfStoch = Stochastic.calculate({
        high: lfValues,
        low: lfValues,
        close: lfValues,
        period: period,
        signalPeriod: 3
    })
    const lfZScores = calculateZScore(lfValues, period)

    // Map back. Stochastic result length = input length - period + 1
    // The result[0] corresponds to the period-th element (index period-1)
    const resultOffset = period - 1

    return rawValues.map((point, i) => {
        let amIndex: number | undefined
        let lfIndex: number | undefined

        if (i >= resultOffset) {
            const indexInResult = i - resultOffset
            // Stochastic returns object usually { k, d }, we want k
            if (amStoch[indexInResult]) amIndex = amStoch[indexInResult].k
            if (lfStoch[indexInResult]) lfIndex = lfStoch[indexInResult].k
        }

        return {
            ...point,
            // Fallback to 50 or undefined for warmup period
            assetManagerIndex: amIndex ?? 50,
            leveragedFundIndex: lfIndex ?? 50,
            assetManagerZScore: amZScores[i] ?? 0,
            leveragedFundZScore: lfZScores[i] ?? 0,
        }
    })
}

export function TFFChart({ data }: { data: RawTFFData[] }) {
    const chartContainerRef = useRef<HTMLDivElement>(null)
    const processedData = processTFFData(data)
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

        const amScaleId = 'am-scale'
        const amSeries = chart.addSeries(LineSeries, {
            priceScaleId: amScaleId, color: '#2563eb', lineWidth: 2, title: 'Asset Manager Index', priceLineVisible: false
        })
        chart.priceScale(amScaleId).applyOptions({ scaleMargins: { top: 0.5, bottom: 0.375 } })
        amSeries.setData(processedData.map(d => ({ time: d.time, value: d.assetManagerIndex ?? 50 })))
        seriesMap.set(amSeries, 'AM Index')
        addIndexExtras(amScaleId)

        const lfScaleId = 'lf-scale'
        const lfSeries = chart.addSeries(LineSeries, {
            priceScaleId: lfScaleId, color: '#16a34a', lineWidth: 2, title: 'Leveraged Fund Index', priceLineVisible: false
        })
        lfSeries.setData(processedData.map(d => ({ time: d.time, value: d.leveragedFundIndex ?? 50 })))
        seriesMap.set(lfSeries, 'LF Index')

        chart.priceScale(lfScaleId).applyOptions({ scaleMargins: { top: 0.635, bottom: 0.25 } })
        addIndexExtras(lfScaleId)

        const amZScaleId = 'am-z-scale'
        const amZSeries = chart.addSeries(LineSeries, {
            priceScaleId: amZScaleId, color: '#60a5fa', lineWidth: 2, title: 'Asset Manager Z-Score', priceLineVisible: false
        })
        amZSeries.setData(processedData.map(d => ({ time: d.time, value: d.assetManagerZScore ?? 0 })))
        seriesMap.set(amZSeries, 'AM Z-Score')
        chart.priceScale(amZScaleId).applyOptions({ scaleMargins: { top: 0.76, bottom: 0.125 } })
        addIndexExtras(amZScaleId, 2, -2)

        const lfZScaleId = 'lf-z-scale'
        const lfZSeries = chart.addSeries(LineSeries, {
            priceScaleId: lfZScaleId, color: '#4ade80', lineWidth: 2, title: 'Leveraged Fund Z-Score', priceLineVisible: false
        })
        lfZSeries.setData(processedData.map(d => ({ time: d.time, value: d.leveragedFundZScore ?? 0 })))
        seriesMap.set(lfZSeries, 'LF Z-Score')

        chart.priceScale(lfZScaleId).applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } })
        addIndexExtras(lfZScaleId, 2, -2)

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
                        <span un-text="xs slate-600">Asset Manager Index</span>
                    </div>
                    <div un-flex="~ items-center gap-1">
                        <div un-w="2" un-h="2" un-rounded="full" un-bg="blue-400"></div>
                        <span un-text="xs slate-600">Asset Manager Z-Score</span>
                    </div>
                    <div un-flex="~ items-center gap-1">
                        <div un-w="2" un-h="2" un-rounded="full" un-bg="green-600"></div>
                        <span un-text="xs slate-600">Leveraged Fund Index</span>
                    </div>
                    <div un-flex="~ items-center gap-1">
                        <div un-w="2" un-h="2" un-rounded="full" un-bg="green-400"></div>
                        <span un-text="xs slate-600">Leveraged Fund Z-Score</span>
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
                        {legend['AM Index'] !== undefined && (
                            <div un-flex="~ gap-2 justify-between">
                                <span un-text="blue-600">Asset Manager Index:</span>
                                <span>{legend['AM Index'].toLocaleString()}</span>
                            </div>
                        )}
                        {legend['LF Index'] !== undefined && (
                            <div un-flex="~ gap-2 justify-between">
                                <span un-text="green-600">Leveraged Fund Index:</span>
                                <span>{legend['LF Index'].toLocaleString()}</span>
                            </div>
                        )}
                        {legend['AM Z-Score'] !== undefined && (
                            <div un-flex="~ gap-2 justify-between">
                                <span un-text="blue-400">Asset Manager Z-Score:</span>
                                <span>{legend['AM Z-Score'].toFixed(2)}</span>
                            </div>
                        )}
                        {legend['LF Z-Score'] !== undefined && (
                            <div un-flex="~ gap-2 justify-between">
                                <span un-text="green-400">Leveraged Fund Z-Score:</span>
                                <span>{legend['LF Z-Score'].toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                )}
                <div ref={chartContainerRef} un-h="full" un-w="full" />
            </div>
        </div>
    )
}
