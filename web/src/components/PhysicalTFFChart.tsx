import { createChart, LineSeries } from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'

export type RawPhysicalData = {
    id: string
    report_date_as_yyyy_mm_dd: string
    open_interest_all: string
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
}

type DataType = 'net' | 'long' | 'short'

const seriesConfig = [
    { key: 'managedMoney', label: 'Managed Money', color: '#16a34a' },
    { key: 'producers', label: 'Producers/Merchants', color: '#2563eb' },
    { key: 'swapDealers', label: 'Swap Dealers', color: '#dc2626' },
    { key: 'otherReportables', label: 'Other Reportables', color: '#94a3b8' },
] as const

export function processPhysicalData(data: RawPhysicalData[], dataType: DataType): ProcessedPoint[] {
    const fn = (val: string) => Number(val ?? '0')
    const getVal = (long: number, short: number) => {
        if (dataType === 'long') return long
        if (dataType === 'short') return short
        return long - short
    }

    return data.map(row => {
        const prodLong = fn(row.prod_merc_positions_long)
        const prodShort = fn(row.prod_merc_positions_short)

        const mmLong = fn(row.m_money_positions_long_all)
        const mmShort = fn(row.m_money_positions_short_all)

        const swapLong = fn(row.swap_positions_long_all)
        const swapShort = fn(row.swap__positions_short_all)

        const otherLong = fn(row.other_rept_positions_long)
        const otherShort = fn(row.other_rept_positions_short)

        return {
            time: row.report_date_as_yyyy_mm_dd.split('T')[0],
            producers: getVal(prodLong, prodShort),
            managedMoney: getVal(mmLong, mmShort),
            swapDealers: getVal(swapLong, swapShort),
            otherReportables: getVal(otherLong, otherShort),
        }
    })
}

export function PhysicalTFFChart({ data }: { data: RawPhysicalData[] }) {
    const chartContainerRef = useRef<HTMLDivElement>(null)
    const seriesMap = useRef<Map<string, any>>(new Map())
    const [dataType, setDataType] = useState<DataType>('net')
    const [legend, setLegend] = useState<any>(null)

    useEffect(() => {
        if (!chartContainerRef.current) return

        const chart = createChart(chartContainerRef.current)
        const seriesByInstance = new Map<any, string>()

        seriesConfig.forEach(conf => {
            const series = chart.addSeries(LineSeries, {
                color: conf.color, lineWidth: 2, title: conf.label
            })
            seriesMap.current.set(conf.key, series)
            seriesByInstance.set(series, conf.label)
        })

        chart.subscribeCrosshairMove((param) => {
            const container = chartContainerRef.current
            if (
                param.point === undefined ||
                !param.time ||
                !container ||
                param.point.x < 0 ||
                param.point.x > container.clientWidth ||
                param.point.y < 0 ||
                param.point.y > container.clientHeight
            ) {
                setLegend(null)
            } else {
                const legendData: any = { date: param.time }
                param.seriesData.forEach((value, series) => {
                    const label = seriesByInstance.get(series)
                    if (label) legendData[label] = (value as any).value
                })
                setLegend(legendData)
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
            seriesMap.current.clear()
        }
    }, [])

    useEffect(() => {
        const processedData = processPhysicalData(data, dataType)
        seriesConfig.forEach(conf => {
            const series = seriesMap.current.get(conf.key)
            if (!series) return
            series.setData(processedData.map(d => ({ time: d.time, value: d[conf.key] })))
        })
    }, [data, dataType])

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
