import type { YahooOption, YahooOptionChainEntry } from '@/utils/yahoo'
import type { ReactNode } from 'react'
import { formatExpirationDate, formatStrike } from './utils'

type Props = {
    chains: YahooOptionChainEntry[]
    strike: number
    spotPrice?: number
}

type Row = {
    expirationDate: number
    dte: number
    call: YahooOption | undefined
    put: YahooOption | undefined
}

function Bar({ value, max, side, children }: {
    value: number
    max: number
    side: 'call' | 'put'
    children: ReactNode
}) {
    const ratio = max > 0 ? Math.min(value / max, 1) : 0
    const isCall = side === 'call'
    return (
        <td un-position="relative">
            {ratio > 0 && (
                <div
                    un-position={isCall ? 'absolute inset-y-0 right-0' : 'absolute inset-y-0 left-0'}
                    un-bg={isCall ? 'green-100' : 'red-100'}
                    style={{ width: `${ratio * 100}%` }}
                />
            )}
            <span
                un-position="relative z-1"
                un-block="~"
                un-text={`right ${isCall ? 'green-700' : 'red-700'} xs`}
                un-p="x-3 y-0.5"
            >
                {children}
            </span>
        </td>
    )
}

const now = Date.now() / 1000

export function OptionStrikeTable({ chains, strike, spotPrice }: Props) {
    const rows: Row[] = chains
        .map(chain => {
            const dte = Math.max(0, Math.round((chain.expirationDate - now) / 86400))
            return {
                expirationDate: chain.expirationDate,
                dte,
                call: chain.calls.find(c => c.strike === strike),
                put: chain.puts.find(p => p.strike === strike),
            }
        })
        .filter(r => r.call != null || r.put != null)

    if (rows.length === 0) {
        return (
            <div un-border="~ amber-200 rounded-lg" un-bg="amber-50" un-p="3" un-text="sm amber-700">
                No data for strike {formatStrike(strike)} across loaded expiration dates.
            </div>
        )
    }

    const maxOf = (nums: number[]) => Math.max(0, ...nums)

    const maxCallLast = maxOf(rows.map(r => r.call?.lastPrice ?? 0))
    const maxCallIV = maxOf(rows.map(r => r.call ? r.call.impliedVolatility * 100 : 0))
    const maxCallVolume = maxOf(rows.map(r => r.call?.volume ?? 0))
    const maxCallOI = maxOf(rows.map(r => r.call?.openInterest ?? 0))
    const maxPutOI = maxOf(rows.map(r => r.put?.openInterest ?? 0))
    const maxPutVolume = maxOf(rows.map(r => r.put?.volume ?? 0))
    const maxPutIV = maxOf(rows.map(r => r.put ? r.put.impliedVolatility * 100 : 0))
    const maxPutLast = maxOf(rows.map(r => r.put?.lastPrice ?? 0))

    const callIsITM = spotPrice != null && strike < spotPrice
    const putIsITM = spotPrice != null && strike > spotPrice

    return (
        <div un-overflow="auto" un-border="~ slate-200 rounded-lg" un-max-h="150">
            <table un-w="full" un-text="xs" un-border="collapse">
                <thead un-position="sticky top-0 z-10">
                    <tr un-border="b slate-200" un-text="slate-500">
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">Last</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">IV</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">Volume</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">OI</th>
                        <th un-text="center" un-p="x-3 y-1" un-border="x slate-200" un-min-w="36">
                            <div un-flex="~ justify-between">
                                <span un-bg="green-50" un-p="x-2">Call ←</span>
                                <span>Expiration</span>
                                <span un-bg="red-50" un-p="x-2">→ Put</span>
                            </div>
                        </th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">OI</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">Volume</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">IV</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">Last</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => {
                        const isNearTerm = row.dte <= 7
                        return (
                            <tr key={row.expirationDate} un-border="b slate-100">
                                <Bar value={row.call?.lastPrice ?? 0} max={maxCallLast} side="call">
                                    {row.call?.lastPrice != null ? `$${row.call.lastPrice.toFixed(2)}` : '—'}
                                </Bar>
                                <Bar value={row.call ? row.call.impliedVolatility * 100 : 0} max={maxCallIV} side="call">
                                    {row.call != null ? `${(row.call.impliedVolatility * 100).toFixed(1)}%` : '—'}
                                </Bar>
                                <Bar value={row.call?.volume ?? 0} max={maxCallVolume} side="call">
                                    {row.call?.volume != null ? row.call.volume.toLocaleString() : '—'}
                                </Bar>
                                <Bar value={row.call?.openInterest ?? 0} max={maxCallOI} side="call">
                                    {row.call?.openInterest != null ? row.call.openInterest.toLocaleString() : '—'}
                                </Bar>

                                <td un-p="x-3 y-0.5" un-border="x slate-200" un-flex='~ justify-center gap-4'>
                                    <span un-font="semibold" un-bg={callIsITM ? 'green-500' : putIsITM ? 'red-500' : 'slate-500'} un-text='white' un-p='x-2' un-border='rounded-lg' >{formatExpirationDate(row.expirationDate)}</span>
                                    <span un-text={`${isNearTerm ? 'orange-500' : 'slate-400'}`}>{row.dte}d</span>
                                </td>

                                <Bar value={row.put?.openInterest ?? 0} max={maxPutOI} side="put">
                                    {row.put?.openInterest != null ? row.put.openInterest.toLocaleString() : '—'}
                                </Bar>
                                <Bar value={row.put?.volume ?? 0} max={maxPutVolume} side="put">
                                    {row.put?.volume != null ? row.put.volume.toLocaleString() : '—'}
                                </Bar>
                                <Bar value={row.put ? row.put.impliedVolatility * 100 : 0} max={maxPutIV} side="put">
                                    {row.put != null ? `${(row.put.impliedVolatility * 100).toFixed(1)}%` : '—'}
                                </Bar>
                                <Bar value={row.put?.lastPrice ?? 0} max={maxPutLast} side="put">
                                    {row.put?.lastPrice != null ? `$${row.put.lastPrice.toFixed(2)}` : '—'}
                                </Bar>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
