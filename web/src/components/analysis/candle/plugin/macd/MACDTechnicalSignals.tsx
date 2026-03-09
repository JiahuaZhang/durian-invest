import { ChevronDown, ChevronUp, Filter } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MACDConfig, SubIndicator } from '../../context/ChartContext';
import { MACDCross, MACDDivergence } from './macd';

type MACDTechnicalSignalsProps = {
    indicator: SubIndicator;
};

export function MACDTechnicalSignals({ indicator }: MACDTechnicalSignalsProps) {
    const [showAllCrosses, setShowAllCrosses] = useState(false);
    const [showAllDivergences, setShowAllDivergences] = useState(false);
    const [filterZeroCross, setFilterZeroCross] = useState(false);

    const macdConfig = indicator.config as MACDConfig;
    const crosses: MACDCross[] = indicator.data?.crosses ?? [];
    const divergences: MACDDivergence[] = indicator.data?.divergences ?? [];

    const filteredCrosses = useMemo(() => {
        if (!filterZeroCross) return crosses;
        return crosses.filter(cross =>
            (cross.type === 'golden' && cross.macdValue > 0) ||
            (cross.type === 'dead' && cross.macdValue < 0)
        );
    }, [crosses, filterZeroCross]);

    return (
        <>
            <div un-flex='~ col gap-2'>
                <div un-flex="~ items-center justify-center gap-2">
                    <div un-text="sm">MACD Crosses</div>
                    <span un-text="xs slate-400">{macdConfig.fastPeriod}/{macdConfig.slowPeriod}/{macdConfig.signalPeriod}</span>
                    <button
                        onClick={() => setFilterZeroCross(p => !p)}
                        un-p="1"
                        un-border="~ rounded"
                        un-bg={filterZeroCross ? 'blue-100' : 'transparent hover:slate-200'}
                        un-text={filterZeroCross ? 'blue-600' : 'slate-400 hover:slate-600'}
                        un-cursor="pointer"
                        title="Filter: Golden > 0, Dead < 0"
                    >
                        <Filter size={14} />
                    </button>
                </div>
                <div un-flex="~ col gap-1" un-max-h="3xs" un-overflow="y-auto" un-border="none" >
                    {(showAllCrosses ? filteredCrosses : filteredCrosses.slice(0, 5)).map((cross, i) => (
                        <div key={i} un-flex="~ items-center gap-2" un-text="xs" un-p="1.5" un-bg="white" un-border="rounded">
                            <span un-text={cross.type === 'golden' ? 'green-600' : 'red-600'} un-w="16">
                                {cross.type === 'golden' ? '↗ Golden' : '↘ Dead'}
                            </span>
                            <span un-text="slate-600" un-flex="1">{cross.date}</span>
                            <span un-text="blue-600 right" un-w="12">{cross.macdValue.toFixed(1)}</span>
                            {cross.daysSinceLastCross && (
                                <span un-text="slate-400 right" un-w="8">{cross.daysSinceLastCross}d</span>
                            )}
                        </div>
                    ))}
                </div>
                {filteredCrosses.length > 5 && (
                    <button
                        onClick={() => setShowAllCrosses(p => !p)}
                        un-flex="~ items-center justify-center gap-1"
                        un-text="xs slate-500 hover:slate-700"
                        un-cursor="pointer"
                    >
                        {showAllCrosses ? (
                            <><ChevronUp size={14} /> Show less</>
                        ) : (
                            <><ChevronDown size={14} /> Show all ({filteredCrosses.length})</>
                        )}
                    </button>
                )}
            </div>

            <div un-border="t slate-200" un-pt="3" un-flex='~ col gap-2' >
                <div un-flex="~ items-center justify-center gap-2">
                    <div un-text="sm">MACD Divergences</div>
                </div>
                <div un-max-h='3xs' un-overflow='y-auto' un-flex="~ col gap-1">
                    {(showAllDivergences ? divergences : divergences.slice(0, 5)).map((div, i) => (
                        <div key={i} un-flex="~ col gap-1" un-text="xs" un-p="1.5" un-bg="white" un-border="rounded">
                            <div un-flex="~ items-center gap-2 justify-between">
                                <span un-text={div.type === 'bullish' ? 'green-600' : 'red-600'}>
                                    {div.type === 'bullish' ? '↑ Bullish' : '↓ Bearish'}
                                </span>
                                <span un-text="slate-500">{div.startDate} → {div.endDate}</span>
                            </div>
                            <div un-text="slate-400" un-flex="~ items-center gap-2 justify-between">
                                <div> Price: </div>
                                <div>
                                    <span un-text={div.type === 'bullish' ? 'green-600' : 'red-600'} >
                                        {div.startPrice.toFixed(1)}
                                    </span>
                                    <span un-text={div.type === 'bullish' ? 'red-600' : 'green-600'} >
                                        {' '} → {div.endPrice.toFixed(1)}
                                    </span>
                                </div>
                            </div>
                            <div un-text="slate-400" un-flex="~ items-center gap-2 justify-between">
                                <div> MACD: </div>
                                <div>
                                    <span un-text={div.type === 'bullish' ? 'red-600' : 'green-600'}>
                                        {div.startMacd.toFixed(1)}
                                    </span>
                                    <span un-text={div.type === 'bullish' ? 'green-600' : 'red-600'}>
                                        {' '} → {div.endMacd.toFixed(1)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                    {divergences.length === 0 && (
                        <div un-text="xs slate-400" un-p="2">No divergences detected</div>
                    )}
                </div>
                {divergences.length > 5 && (
                    <button
                        onClick={() => setShowAllDivergences(p => !p)}
                        un-flex="~ items-center justify-center gap-1"
                        un-text="xs slate-500 hover:slate-700"
                        un-cursor="pointer"
                    >
                        {showAllDivergences ? (
                            <><ChevronUp size={14} /> Show less</>
                        ) : (
                            <><ChevronDown size={14} /> Show all ({divergences.length})</>
                        )}
                    </button>
                )}
            </div>
        </>
    );
}
