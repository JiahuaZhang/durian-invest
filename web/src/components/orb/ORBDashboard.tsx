import { createChart, HistogramSeries } from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { ORBDailySummary, ORBTradeRow } from '../../data/orb'
import { ORBTradeTable } from './ORBTradeTable'

type Props = {
    trades: ORBTradeRow[]
    summaries: ORBDailySummary[]
    startDate: string
    endDate: string
    symbol: string
    onFilterChange: (filters: { startDate?: string; endDate?: string; symbol?: string }) => void
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div un-rounded="xl" un-border="~ slate-200" un-shadow="sm" un-p="4">
            <div un-text="xs slate-500" un-mb="1">{label}</div>
            <div un-text="2xl slate-900" un-font="semibold">{value}</div>
            {sub && <div un-text="xs slate-400" un-mt="1">{sub}</div>}
        </div>
    )
}

function PnlChart({ summaries }: { summaries: ORBDailySummary[] }) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!containerRef.current || !summaries.length) return

        const chart = createChart(containerRef.current, { height: 220 })
        const series = chart.addSeries(HistogramSeries, {
            priceScaleId: '',
            lastValueVisible: false,
            priceLineVisible: false,
        })

        chart.priceScale('').applyOptions({
            scaleMargins: { top: 0.1, bottom: 0.1 },
        })

        series.setData(
            summaries.map(s => ({
                time: s.date as any,
                value: s.total_pnl,
                color: s.total_pnl >= 0 ? '#26a69a' : '#ef5350',
            }))
        )

        chart.timeScale().fitContent()
        return () => chart.remove()
    }, [summaries])

    if (!summaries.length) {
        return <div un-text="center slate-400" un-p="8">No daily data yet.</div>
    }

    return <div ref={containerRef} un-w="full" un-rounded="lg" un-overflow="hidden" />
}

const SYMBOLS = ['', 'SPY', 'QQQ', 'NVDA', 'GOOG']

export function ORBDashboard({ trades, summaries, startDate, endDate, symbol, onFilterChange }: Props) {
    // Aggregate stats
    const totalTrades = trades.length
    const closedTrades = trades.filter(t => t.status === 'closed')
    const wins = closedTrades.filter(t => t.pnl !== null && t.pnl > 0).length
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length * 100).toFixed(1) : '0'
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
    const avgRangeSize = trades.length > 0
        ? (trades.reduce((sum, t) => sum + (t.range_size ?? 0), 0) / trades.length).toFixed(2)
        : '0'

    return (
        <div un-flex="~ col gap-6">
            {/* Filters */}
            <div un-flex="~ gap-3 items-end wrap">
                <div un-flex="~ items-center gap-1">
                    <label un-text="xs slate-500">From</label>
                    <input type="date" value={startDate}
                        onChange={e => onFilterChange({ startDate: e.target.value })}
                        un-border="~ slate-300 rounded-lg" un-p="x-3 y-1.5" un-text="sm"
                    />
                </div>
                <div un-flex="~ items-center gap-1">
                    <label un-text="xs slate-500">To</label>
                    <input type="date" value={endDate}
                        onChange={e => onFilterChange({ endDate: e.target.value })}
                        un-border="~ slate-300 rounded-lg" un-p="x-3 y-1.5" un-text="sm"
                    />
                </div>
                <div un-flex="~ items-center gap-1">
                    <label un-text="xs slate-500">Symbol</label>
                    <select value={symbol}
                        onChange={e => onFilterChange({ symbol: e.target.value })}
                        un-border="~ slate-300 rounded-lg" un-p="x-3 y-1.5" un-text="sm" un-bg="white"
                    >
                        {SYMBOLS.map(s => (
                            <option key={s} value={s}>{s || 'All'}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Summary Cards */}
            <div un-grid="~ cols-4 gap-4">
                <StatCard label="Total Trades" value={String(totalTrades)} sub={`${closedTrades.length} closed`} />
                <StatCard label="Win Rate" value={`${winRate}%`} sub={`${wins}W / ${closedTrades.length - wins}L`} />
                <StatCard label="Total P&L" value={`$${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`} />
                <StatCard label="Avg Range Size" value={`$${avgRangeSize}`} />
            </div>

            {/* Daily P&L Chart */}
            <div un-rounded="xl" un-border="~ slate-200" un-shadow="sm" un-p="4">
                <h3 un-text="sm slate-700" un-font="semibold" un-mb="3">Daily P&L</h3>
                <PnlChart summaries={summaries} />
            </div>

            {/* Trade Table */}
            <div un-rounded="xl" un-border="~ slate-200" un-shadow="sm" un-p="4">
                <h3 un-text="sm slate-700" un-font="semibold" un-mb="3">Trade History</h3>
                <ORBTradeTable trades={trades} />
            </div>
        </div>
    )
}
