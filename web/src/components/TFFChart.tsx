import { createChart, LineSeries } from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'

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

type DataType = 'net' | 'long' | 'short'

export type ProcessedPoint = {
    time: string
    assetManagers: number
    leveragedFunds: number
    dealers: number
    otherReportables: number
}

const seriesConfig = [
    { key: 'assetManagers', label: 'Asset Managers', color: '#2563eb' },
    { key: 'leveragedFunds', label: 'Leveraged Funds', color: '#16a34a' },
    { key: 'dealers', label: 'Dealers', color: '#dc2626' },
    { key: 'otherReportables', label: 'Other Reportables', color: '#94a3b8' }
] as const

export function processTFFData(data: RawTFFData[], dataType: DataType): ProcessedPoint[] {
    const fn = (val: string) => Number(val ?? '0')

    return data.map(row => {
        const amLong = fn(row.asset_mgr_positions_long)
        const amShort = fn(row.asset_mgr_positions_short)

        const lfLong = fn(row.lev_money_positions_long)
        const lfShort = fn(row.lev_money_positions_short)

        const dealerLong = fn(row.dealer_positions_long_all)
        const dealerShort = fn(row.dealer_positions_short_all)

        const otherLong = fn(row.other_rept_positions_long)
        const otherShort = fn(row.other_rept_positions_short)

        const getVal = (long: number, short: number) => {
            if (dataType === 'long') return long
            if (dataType === 'short') return short
            return long - short
        }

        return {
            time: row.report_date_as_yyyy_mm_dd.split('T')[0],
            assetManagers: getVal(amLong, amShort),
            leveragedFunds: getVal(lfLong, lfShort),
            dealers: getVal(dealerLong, dealerShort),
            otherReportables: getVal(otherLong, otherShort)
        }
    })
}

export function TFFChart({ data }: { data: RawTFFData[] }) {
    const chartContainerRef = useRef<HTMLDivElement>(null)
    const [dataType, setDataType] = useState<DataType>('net')
    const [legend, setLegend] = useState<any>(null)

    const processedData = processTFFData(data, dataType)

    useEffect(() => {
        if (!chartContainerRef.current) return

        const chart = createChart(chartContainerRef.current)

        const seriesMap = new Map<any, string>()

        seriesConfig.forEach(conf => {
            const series = chart.addSeries(LineSeries, {
                color: conf.color, lineWidth: 2, title: conf.label
            })
            series.setData(processedData.map(d => ({ time: d.time, value: Number((d as any)[conf.key] ?? 0) })))
            seriesMap.set(series, conf.label)
        })

        chart.subscribeCrosshairMove((param) => {
            if (param.time && param.point) {
                const legendData: any = { date: param.time }
                param.seriesData.forEach((value, series) => {
                    const label = seriesMap.get(series)
                    if (label) {
                        legendData[label] = (value as any).value
                    }
                })
                setLegend(legendData)
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

        chart.timeScale().fitContent()

        return () => {
            window.removeEventListener('resize', handleResize)
            chart.remove()
        }
    }, [processedData])

    return (
        <div un-flex="~ col gap-2" un-border="~ slate-200 rounded" un-shadow="sm" un-p="4">
            <div un-flex="~ gap-4 items-center justify-between">
                <div un-flex="~ gap-3">
                    {seriesConfig.map((conf) => (
                        <div key={conf.key} un-flex="~ gap-2 items-center">
                            <div un-w="3" un-h="3" un-rounded="full" style={{ backgroundColor: conf.color }}></div>
                            <span un-text="sm" style={{ color: conf.color }}>{conf.label}</span>
                        </div>
                    ))}
                </div>

                <div un-flex="~ gap-1" un-bg='slate-100' un-border='rounded-lg' un-p="1">
                    {(['net', 'long', 'short'] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setDataType(t)}
                            un-cursor='pointer'
                            un-p="x-3 y-1"
                            un-rounded="md"
                            un-bg={`${dataType === t ? 'white' : 'slate-100'}`}
                            un-text={`sm ${dataType === t ? 'slate-800' : 'slate-500'}`}
                            un-shadow={`${dataType === t ? 'shadow-sm' : ''}`}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            <div un-position="relative" un-h="lg">
                {legend && (
                    <div un-position="absolute top-2 left-2" un-z="10" un-p="3" un-bg='white/90 backdrop-blur-sm' un-shadow="sm" un-border="~ slate-200 rounded-lg" un-text="sm" un-font="mono">
                        <div un-text="slate-500" un-mb="1">{legend.date}</div>
                        <div un-flex="~ col gap-1">
                            {seriesConfig.map(conf => {
                                const val = legend[conf.label]
                                if (val === undefined) return null
                                return (
                                    <div key={conf.key} un-flex="~ gap-4 justify-between items-center">
                                        <div un-flex="~ items-center gap-2">
                                            <div un-w="2" un-h="2" un-rounded="full" style={{ backgroundColor: conf.color }}></div>
                                            <span style={{ color: conf.color }} un-font="semibold">{conf.label}</span>
                                        </div>
                                        <span un-font="semibold">{val.toLocaleString()}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
                <div ref={chartContainerRef} un-h="full" un-w="full" />
            </div>
        </div>
    )
}
