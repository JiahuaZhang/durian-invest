import type { ChainSideStats, YahooOptionChainEntry } from '@/utils/yahoo'
import type { ReactNode } from 'react'
import { formatStrike } from './utils'

function calcPremiumBreakdown(type: 'call' | 'put', strike: number, spot: number, lastPrice: number) {
    const intrinsic = type === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot)
    return { intrinsic, extrinsic: Math.max(0, lastPrice - intrinsic) }
}

// Renders a table cell with a proportional background bar anchored toward the strike column.
// Call side bars anchor right; put side bars anchor left — creating a butterfly effect.
function BarCell({ value, stats, field, isITM, side, children }: {
    value: number
    stats: ChainSideStats
    field: keyof ChainSideStats
    isITM: boolean
    side: 'call' | 'put'
    children: ReactNode
}) {
    const max = stats[field]
    const ratio = max > 0 ? Math.min(value / max, 1) : 0
    const isCall = side === 'call'

    return (
        <td un-position="relative">
            {ratio > 0 && (
                <div
                    un-position={isCall ? 'absolute inset-y-0 right-0' : 'absolute inset-y-0 left-0'}
                    un-bg={isCall ? (isITM ? 'green-200' : 'green-100') : (isITM ? 'red-200' : 'red-100')}
                    style={{ width: `${ratio * 100}%` }}
                />
            )}
            <span
                un-position="relative z-1"
                un-block='~'
                un-text={`right ${isITM ? (isCall ? 'green-700' : 'red-700') : 'slate-500'}`}
                un-p="x-3 y-0.5"
            >
                {children}
            </span>
        </td>
    )
}

type Props = {
    chain: YahooOptionChainEntry | null
    spotPrice?: number
}

export function OptionChainTable({ chain, spotPrice }: Props) {
    if (!chain) return null

    const callMap = new Map(chain.calls.map(c => [c.strike, c]))
    const putMap = new Map(chain.puts.map(p => [p.strike, p]))

    const allStrikes = Array.from(
        new Set([...chain.calls.map(c => c.strike), ...chain.puts.map(p => p.strike)])
    ).sort((a, b) => a - b)

    const atmStrike = spotPrice != null && allStrikes.length > 0
        ? allStrikes.reduce((best, s) => Math.abs(s - spotPrice) < Math.abs(best - spotPrice) ? s : best, allStrikes[0])
        : 0

    const { call: callStats, put: putStats } = chain.chainStats

    return (
        <div un-overflow="auto" un-border="~ slate-200 rounded-lg" un-max-h="150">
            <table un-w="full" un-text="xs" un-border="collapse">
                <thead un-position="sticky top-0 z-10" un-bg="white">
                    <tr un-border="b slate-200" un-text="slate-500">
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">Last</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">Intrinsic</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">Extrinsic</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">IV</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">Volume</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">OI</th>
                        <th un-text="center" un-p="x-3 y-1" un-border="x slate-200">
                            <div un-flex="~ justify-between">
                                <span un-bg="green-50" un-p='x-2'>Call ←</span>
                                <span>Strike</span>
                                <span un-bg="red-50" un-p='x-2'>→ Put</span>
                            </div>
                        </th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">OI</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">Volume</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">IV</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">Extrinsic</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">Intrinsic</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">Last</th>
                    </tr>
                </thead>
                <tbody>
                    {allStrikes.map(strike => {
                        const call = callMap.get(strike)
                        const put = putMap.get(strike)
                        const isATM = strike === atmStrike
                        const isCallITM = call ? call.inTheMoney : strike < atmStrike
                        const isPutITM = put ? put.inTheMoney : strike > atmStrike

                        const callBreakdown = spotPrice != null && call?.lastPrice != null
                            ? calcPremiumBreakdown('call', strike, spotPrice, call.lastPrice) : null
                        const putBreakdown = spotPrice != null && put?.lastPrice != null
                            ? calcPremiumBreakdown('put', strike, spotPrice, put.lastPrice) : null

                        return (
                            <tr key={strike} un-border="b slate-100">
                                <BarCell value={call?.lastPrice ?? 0} stats={callStats} field="maxLastPrice" isITM={isCallITM} side="call">
                                    {call?.lastPrice != null ? `$${call.lastPrice.toFixed(2)}` : '—'}
                                </BarCell>
                                <BarCell value={callBreakdown?.intrinsic ?? 0} stats={callStats} field="maxIntrinsic" isITM={isCallITM} side="call">
                                    {callBreakdown != null ? `$${callBreakdown.intrinsic.toFixed(2)}` : '—'}
                                </BarCell>
                                <BarCell value={callBreakdown?.extrinsic ?? 0} stats={callStats} field="maxExtrinsic" isITM={isCallITM} side="call">
                                    {callBreakdown != null ? `$${callBreakdown.extrinsic.toFixed(2)}` : '—'}
                                </BarCell>
                                <BarCell value={call != null ? call.impliedVolatility * 100 : 0} stats={callStats} field="maxIV" isITM={isCallITM} side="call">
                                    {call != null ? `${(call.impliedVolatility * 100).toFixed(1)}%` : '—'}
                                </BarCell>
                                <BarCell value={call?.volume ?? 0} stats={callStats} field="maxVolume" isITM={isCallITM} side="call">
                                    {call?.volume != null ? call.volume.toLocaleString() : '—'}
                                </BarCell>
                                <BarCell value={call?.openInterest ?? 0} stats={callStats} field="maxOI" isITM={isCallITM} side="call">
                                    {call?.openInterest != null ? call.openInterest.toLocaleString() : '—'}
                                </BarCell>

                                <td
                                    un-text={`center ${isATM ? 'blue-600' : 'slate-700'}`}
                                    un-p="x-3 y-0.5"
                                    un-bg={isATM ? 'blue-50' : isCallITM ? 'green-50' : 'red-50'}
                                    un-border="x slate-200"
                                >
                                    {formatStrike(strike)}
                                </td>

                                <BarCell value={put?.openInterest ?? 0} stats={putStats} field="maxOI" isITM={isPutITM} side="put">
                                    {put?.openInterest != null ? put.openInterest.toLocaleString() : '—'}
                                </BarCell>
                                <BarCell value={put?.volume ?? 0} stats={putStats} field="maxVolume" isITM={isPutITM} side="put">
                                    {put?.volume != null ? put.volume.toLocaleString() : '—'}
                                </BarCell>
                                <BarCell value={put != null ? put.impliedVolatility * 100 : 0} stats={putStats} field="maxIV" isITM={isPutITM} side="put">
                                    {put != null ? `${(put.impliedVolatility * 100).toFixed(1)}%` : '—'}
                                </BarCell>
                                <BarCell value={putBreakdown?.extrinsic ?? 0} stats={putStats} field="maxExtrinsic" isITM={isPutITM} side="put">
                                    {putBreakdown != null ? `$${putBreakdown.extrinsic.toFixed(2)}` : '—'}
                                </BarCell>
                                <BarCell value={putBreakdown?.intrinsic ?? 0} stats={putStats} field="maxIntrinsic" isITM={isPutITM} side="put">
                                    {putBreakdown != null ? `$${putBreakdown.intrinsic.toFixed(2)}` : '—'}
                                </BarCell>
                                <BarCell value={put?.lastPrice ?? 0} stats={putStats} field="maxLastPrice" isITM={isPutITM} side="put">
                                    {put?.lastPrice != null ? `$${put.lastPrice.toFixed(2)}` : '—'}
                                </BarCell>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
