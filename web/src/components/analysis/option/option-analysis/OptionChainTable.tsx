import type { YahooOptionChainEntry } from '@/utils/yahoo'
import { formatStrike } from './utils'

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

    return (
        <div un-overflow="auto" un-border="~ slate-200 rounded-lg" un-max-h="96">
            <table un-w="full" un-text="xs" un-border="collapse">
                <thead un-position="sticky top-0 z-1" un-bg="white">
                    <tr un-border="b slate-200" un-text="slate-500">
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">Last</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">IV</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">Volume</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="green-50">OI</th>
                        <th un-text="center" un-p="x-3 y-1" un-border="x slate-200">
                            <div un-flex="~ justify-between">
                                <span un-bg="green-50" un-p='x-2' >Call ←</span>
                                <span>Strike</span>
                                <span un-bg="red-50" un-p='x-2' >→ Put</span>
                            </div>
                        </th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">OI</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">Volume</th>
                        <th un-text="right" un-p="x-3 y-1" un-bg="red-50">IV</th>
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

                        return (
                            <tr key={strike} un-border="b slate-100">
                                <td un-text="right" un-p="x-3 y-0.5" un-bg={isCallITM ? 'green-50' : ''}>
                                    <span un-text={isCallITM ? 'green-700' : 'slate-500'}>
                                        {call?.lastPrice != null ? `$${call.lastPrice.toFixed(2)}` : '—'}
                                    </span>
                                </td>
                                <td un-text="right" un-p="x-3 y-0.5" un-bg={isCallITM ? 'green-50' : ''}>
                                    <span un-text={isCallITM ? 'green-700' : 'slate-500'}>
                                        {call != null ? `${(call.impliedVolatility * 100).toFixed(1)}%` : '—'}
                                    </span>
                                </td>
                                <td un-text="right" un-p="x-3 y-0.5" un-bg={isCallITM ? 'green-50' : ''}>
                                    <span un-text={isCallITM ? 'green-700' : 'slate-500'}>
                                        {call?.volume != null ? call.volume.toLocaleString() : '—'}
                                    </span>
                                </td>
                                <td un-text="right" un-p="x-3 y-0.5" un-bg={isCallITM ? 'green-50' : ''}>
                                    <span un-text={isCallITM ? 'green-700' : 'slate-500'}>
                                        {call?.openInterest != null ? call.openInterest.toLocaleString() : '—'}
                                    </span>
                                </td>
                                <td
                                    un-text={`center ${isATM ? 'blue-600' : 'slate-700'}`}
                                    un-p="x-3 y-0.5"
                                    un-bg={isATM ? 'blue-50' : isCallITM ? 'green-50' : 'red-50'}
                                    un-border="x slate-200"
                                >
                                    {formatStrike(strike)}
                                </td>
                                <td un-text="right" un-p="x-3 y-0.5" un-bg={isPutITM ? 'red-50' : ''}>
                                    <span un-text={isPutITM ? 'red-700' : 'slate-500'}>
                                        {put?.openInterest != null ? put.openInterest.toLocaleString() : '—'}
                                    </span>
                                </td>
                                <td un-text="right" un-p="x-3 y-0.5" un-bg={isPutITM ? 'red-50' : ''}>
                                    <span un-text={isPutITM ? 'red-700' : 'slate-500'}>
                                        {put?.volume != null ? put.volume.toLocaleString() : '—'}
                                    </span>
                                </td>
                                <td un-text="right" un-p="x-3 y-0.5" un-bg={isPutITM ? 'red-50' : ''}>
                                    <span un-text={isPutITM ? 'red-700' : 'slate-500'}>
                                        {put != null ? `${(put.impliedVolatility * 100).toFixed(1)}%` : '—'}
                                    </span>
                                </td>
                                <td un-text="right" un-p="x-3 y-0.5" un-bg={isPutITM ? 'red-50' : ''}>
                                    <span un-text={isPutITM ? 'red-700' : 'slate-500'}>
                                        {put?.lastPrice != null ? `$${put.lastPrice.toFixed(2)}` : '—'}
                                    </span>
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
