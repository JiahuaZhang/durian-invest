import { useState } from 'react'
import { Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import type { ORBTradeRow, ORBOpeningRange } from '../../data/orb'
import { fetchORBOpeningRange } from '../../data/orb'
import { ORBRangeChart } from './ORBRangeChart'

type Props = {
    trades: ORBTradeRow[]
}

function FilterIcon({ value }: { value: boolean | null }) {
    if (value === null) return <span un-text="slate-300">-</span>
    return value
        ? <Check size={14} un-text="green-600" />
        : <X size={14} un-text="red-500" />
}

function formatPnl(pnl: number | null) {
    if (pnl === null) return '-'
    const color = pnl >= 0 ? 'green-600' : 'red-600'
    return <span un-text={color} un-font="mono">${pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>
}

function formatPct(pct: number | null) {
    if (pct === null) return '-'
    const color = pct >= 0 ? 'green-600' : 'red-600'
    return <span un-text={color} un-font="mono">{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
}

const exitReasonLabels: Record<string, string> = {
    stop_loss: 'Stop Loss',
    take_profit: 'Take Profit',
    eod_close: 'EOD Close',
}

export function ORBTradeTable({ trades }: Props) {
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [rangeData, setRangeData] = useState<ORBOpeningRange | null>(null)

    async function toggleExpand(trade: ORBTradeRow) {
        if (expandedId === trade.id) {
            setExpandedId(null)
            setRangeData(null)
            return
        }
        setExpandedId(trade.id)
        try {
            const data = await fetchORBOpeningRange({ data: { date: trade.date, symbol: trade.symbol } })
            setRangeData(data)
        } catch {
            setRangeData(null)
        }
    }

    if (!trades.length) {
        return <div un-text="center slate-400" un-p="8">No trades found for this period.</div>
    }

    return (
        <div un-overflow="x-auto">
            <table un-w="full" un-text="sm">
                <thead>
                    <tr un-border="b slate-200" un-text="left slate-500 xs" un-font="medium">
                        <th un-p="x-3 y-2" un-w="8"></th>
                        <th un-p="x-3 y-2">Date</th>
                        <th un-p="x-3 y-2">Symbol</th>
                        <th un-p="x-3 y-2">Direction</th>
                        <th un-p="x-3 y-2">Entry</th>
                        <th un-p="x-3 y-2">Exit</th>
                        <th un-p="x-3 y-2">P&L</th>
                        <th un-p="x-3 y-2">P&L%</th>
                        <th un-p="x-3 y-2">Exit Reason</th>
                        <th un-p="x-3 y-2" un-text="center">Body</th>
                        <th un-p="x-3 y-2" un-text="center">Vol</th>
                        <th un-p="x-3 y-2" un-text="center">VWAP</th>
                    </tr>
                </thead>
                <tbody>
                    {trades.map(trade => (
                        <>
                            <tr key={trade.id}
                                un-border="b slate-100"
                                un-cursor="pointer"
                                un-bg="hover:slate-50"
                                un-transition="colors"
                                onClick={() => toggleExpand(trade)}
                            >
                                <td un-p="x-3 y-2">
                                    {expandedId === trade.id
                                        ? <ChevronDown size={14} />
                                        : <ChevronRight size={14} />
                                    }
                                </td>
                                <td un-p="x-3 y-2" un-font="mono">{trade.date}</td>
                                <td un-p="x-3 y-2" un-font="semibold">{trade.symbol}</td>
                                <td un-p="x-3 y-2">
                                    <span un-text={trade.signal_direction === 'long' ? 'green-600' : 'red-600'}
                                        un-font="medium"
                                    >
                                        {trade.signal_direction?.toUpperCase()}
                                    </span>
                                </td>
                                <td un-p="x-3 y-2" un-font="mono">${trade.entry_price.toFixed(2)}</td>
                                <td un-p="x-3 y-2" un-font="mono">
                                    {trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '-'}
                                </td>
                                <td un-p="x-3 y-2">{formatPnl(trade.pnl)}</td>
                                <td un-p="x-3 y-2">{formatPct(trade.pnl_pct)}</td>
                                <td un-p="x-3 y-2">
                                    <span un-text="xs" un-bg="slate-100" un-p="x-2 y-0.5" un-rounded="full">
                                        {trade.exit_reason ? exitReasonLabels[trade.exit_reason] ?? trade.exit_reason : '-'}
                                    </span>
                                </td>
                                <td un-p="x-3 y-2" un-text="center"><FilterIcon value={trade.body_close_confirmed} /></td>
                                <td un-p="x-3 y-2" un-text="center"><FilterIcon value={trade.volume_confirmed} /></td>
                                <td un-p="x-3 y-2" un-text="center"><FilterIcon value={trade.vwap_confirmed} /></td>
                            </tr>

                            {expandedId === trade.id && (
                                <tr key={`${trade.id}-detail`} un-bg="slate-50">
                                    <td colSpan={12} un-p="4">
                                        <div un-flex="~ gap-6" un-text="xs slate-600">
                                            <div un-flex="~ col gap-1">
                                                <span>Range: ${trade.range_high?.toFixed(2)} - ${trade.range_low?.toFixed(2)}</span>
                                                <span>Range Size: ${trade.range_size?.toFixed(2)}</span>
                                                <span>SL: ${trade.stop_loss_price.toFixed(2)} | TP: ${trade.take_profit_price.toFixed(2)}</span>
                                                <span>Qty: {trade.qty} | Variant: {trade.variant}</span>
                                            </div>
                                            <div un-flex="~ 1">
                                                {rangeData && (
                                                    <ORBRangeChart
                                                        range={rangeData}
                                                        entryPrice={trade.entry_price}
                                                        exitPrice={trade.exit_price ?? undefined}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
