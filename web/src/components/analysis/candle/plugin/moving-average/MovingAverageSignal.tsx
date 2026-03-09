import { ChevronDown, ChevronUp, Filter } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CandleData, OverlayIndicator, useCandleData } from '../../context/ChartContext';
import type { MAConfig } from './ma';

export type MACross = {
    date: string;
    type: 'bullish' | 'bearish';
    price: number;
    maValue: number;
    daysSinceLastCross?: number;
};

export function findMACrosses(data: CandleData[], maData: { time: unknown; value: number }[]): MACross[] {
    const crosses: MACross[] = [];

    // Build a map from time -> MA value for quick lookup
    const maMap = new Map<string, number>();
    for (const d of maData) {
        maMap.set(String(d.time), d.value);
    }

    for (let i = 1; i < data.length; i++) {
        const prevClose = data[i - 1].close;
        const currClose = data[i].close;
        const prevMA = maMap.get(data[i - 1].time);
        const currMA = maMap.get(data[i].time);

        if (prevMA === undefined || currMA === undefined) continue;

        const prevDiff = prevClose - prevMA;
        const currDiff = currClose - currMA;

        if (prevDiff <= 0 && currDiff > 0) {
            crosses.push({ date: data[i].time, type: 'bullish', price: currClose, maValue: currMA });
        } else if (prevDiff >= 0 && currDiff < 0) {
            crosses.push({ date: data[i].time, type: 'bearish', price: currClose, maValue: currMA });
        }
    }

    for (let i = 1; i < crosses.length; i++) {
        const prev = new Date(crosses[i - 1].date);
        const curr = new Date(crosses[i].date);
        crosses[i].daysSinceLastCross = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    }

    return crosses.reverse();
}

type MovingAverageSignalProps = {
    overlay: OverlayIndicator;
};

export function MovingAverageSignal({ overlay }: MovingAverageSignalProps) {
    const [showAll, setShowAll] = useState(false);
    const [filterOneYear, setFilterOneYear] = useState(true);

    const data = useCandleData();
    const config = overlay.config as MAConfig;
    const maData: { time: unknown; value: number }[] = overlay.data ?? [];

    const label = overlay.type === 'sma' ? 'Simple' : 'Exponential';

    const allCrosses = useMemo(() => findMACrosses(data, maData), [data, maData]);

    const crosses = useMemo(() => {
        if (!filterOneYear) return allCrosses;
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        return allCrosses.filter(cross => new Date(cross.date) >= oneYearAgo);
    }, [allCrosses, filterOneYear]);

    return (
        <div un-flex='~ col gap-2'>
            <div un-flex="~ items-center justify-center gap-2">
                <div un-text="sm">{label} Moving Average {config.period}</div>
                <button
                    onClick={() => setFilterOneYear(p => !p)}
                    un-p="1"
                    un-border="~ rounded"
                    un-bg={filterOneYear ? 'blue-100' : 'transparent hover:slate-200'}
                    un-text={filterOneYear ? 'blue-600' : 'slate-400 hover:slate-600'}
                    un-cursor="pointer"
                    title="Filter: Last 1 year only"
                >
                    <Filter size={14} />
                </button>
            </div>
            <div un-flex="~ col gap-1" un-max-h="3xs" un-overflow="y-auto" un-border="none">
                {(showAll ? crosses : crosses.slice(0, 5)).map((cross, i) => (
                    <div key={i} un-flex="~ items-center gap-2" un-text="xs" un-p="1.5" un-bg="white" un-border="rounded">
                        <span un-text={cross.type === 'bullish' ? 'green-600' : 'red-600'} un-w="16">
                            {cross.type === 'bullish' ? '↑ Bullish' : '↓ Bearish'}
                        </span>
                        <span un-text="slate-600" un-flex="1">{cross.date}</span>
                        <span un-text="blue-600 right" un-w="12">{cross.price.toFixed(1)}</span>
                        {cross.daysSinceLastCross && (
                            <span un-text="slate-400 right" un-w="8">{cross.daysSinceLastCross}d</span>
                        )}
                    </div>
                ))}
                {crosses.length === 0 && (
                    <div un-text="xs slate-400" un-p="2">No crosses detected</div>
                )}
            </div>
            {crosses.length > 5 && (
                <button
                    onClick={() => setShowAll(p => !p)}
                    un-flex="~ items-center justify-center gap-1"
                    un-text="xs slate-500 hover:slate-700"
                    un-cursor="pointer"
                >
                    {showAll ? (
                        <><ChevronUp size={14} /> Show less</>
                    ) : (
                        <><ChevronDown size={14} /> Show all ({crosses.length})</>
                    )}
                </button>
            )}
        </div>
    );
}
