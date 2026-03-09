import { useIndicators, useOverlays } from './context/ChartContext';
import { useMemo } from 'react';
import { MACDTechnicalSignals } from './plugin/macd/MACDTechnicalSignals';
import { MovingAverageSignal } from './plugin/moving-average/MovingAverageSignal';

export function TechnicalSignals() {
    const { indicators } = useIndicators();
    const { overlays: overlaysRecord } = useOverlays();

    const macdIndicators = useMemo(() => Object.values(indicators).filter(i => i.type === 'macd'), [indicators]);
    const maOverlays = useMemo(() => Object.values(overlaysRecord).filter(o => (o.type === 'sma' || o.type === 'ema') && o.visible), [overlaysRecord]);

    return (
        <div un-min-w="xs" un-shrink="0" un-max-h="xl" un-border="~ slate-200 rounded-lg" un-bg="slate-50" un-p="3" un-flex="~ col gap-3" un-overflow="y-auto">
            {maOverlays.map(overlay => (
                <MovingAverageSignal key={overlay.id} overlay={overlay} />
            ))}
            {macdIndicators.map(indicator => (
                <MACDTechnicalSignals key={indicator.id} indicator={indicator} />
            ))}
        </div>
    );
}
