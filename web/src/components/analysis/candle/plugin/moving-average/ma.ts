import { createChart, ISeriesApi, LineSeries, Time } from 'lightweight-charts';
import { EMA, SMA } from 'technicalindicators';
import type { CandleData, OverlayIndicator } from '../../context/ChartContext';
import { findMACrosses } from './MovingAverageSignal';

import type { MetaField } from '../meta';
import { getDefaultConfig, type DeriveConfig } from '../meta';

// ── Meta definition (single source of truth) ─────────────────────────────

export const MAMeta = [
    { key: 'period', label: 'Period', group: 'Inputs', type: 'number', default: 20, min: 1, max: 500 },
    { key: 'showCrossSignals', label: 'Show Cross Signals', group: 'Inputs', type: 'boolean', default: false },
    { key: 'color', label: 'Color', group: 'Style', type: 'color', default: '#2962FF' },
    {
        key: 'lineWidth', label: 'Line Width', group: 'Style', type: 'select', default: 1,
        options: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }] as const
    },
    { key: 'bullishColor', label: 'Bullish Color', group: 'Style', type: 'color', default: '#2b7fff' },
    { key: 'bearishColor', label: 'Bearish Color', group: 'Style', type: 'color', default: '#e7000b' },
] as const satisfies readonly MetaField[];

// ── Derived config type ──────────────────────────────────────────────────

export type MAConfig = DeriveConfig<typeof MAMeta>;

// ── Default config ───────────────────────────────────────────────────────

export function getDefaultMAConfig(type: 'sma' | 'ema'): MAConfig {
    const config = getDefaultConfig(MAMeta);
    if (type === 'ema') {
        config.color = '#FF6D00';
    }
    return config;
}

// ── Data computation ─────────────────────────────────────────────────────

export function computeMAData(candleData: CandleData[], type: 'sma' | 'ema', config: MAConfig) {
    const closePrices = candleData.map(d => d.close);
    const calculatedValues = type === 'sma'
        ? SMA.calculate({ period: config.period, values: closePrices })
        : EMA.calculate({ period: config.period, values: closePrices });

    if (!calculatedValues.length) return [];

    return candleData.slice(config.period - 1).map((d, i) => ({
        time: d.time as unknown as Time,
        value: calculatedValues[i],
    }));
}

// ── Series creation ──────────────────────────────────────────────────────

export function createMASeries(
    chart: ReturnType<typeof createChart>,
    config: MAConfig,
): ISeriesApi<'Line'> {
    return chart.addSeries(LineSeries, {
        color: config.color,
        lineWidth: config.lineWidth as 1 | 2 | 3 | 4,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
    });
}

// ── Cross signal markers ─────────────────────────────────────────────────

export type MAMarker = {
    time: string;
    position: 'belowBar' | 'aboveBar';
    color: string;
    shape: 'arrowUp' | 'arrowDown';
    text: string;
    textColor?: string;
};

export function buildMACrossMarkers(overlays: OverlayIndicator[], data: CandleData[]): MAMarker[] {
    const allMarkers: MAMarker[] = [];

    overlays.forEach(overlay => {
        const crosses = findMACrosses(data, overlay.data);
        const config = overlay.config as MAConfig;
        const label = overlay.type === 'sma' ? `SMA${config.period}` : `EMA${config.period}`;

        crosses.forEach(cross => {
            const isBull = cross.type === 'bullish';
            allMarkers.push({
                time: cross.date,
                position: isBull ? 'belowBar' : 'aboveBar',
                color: isBull ? config.bullishColor : config.bearishColor,
                shape: isBull ? 'arrowUp' : 'arrowDown',
                text: `${isBull ? 'Bull' : 'Bear'} ${label}`,
            });
        });
    });

    allMarkers.sort((a, b) => a.time.localeCompare(b.time));
    return allMarkers;
}
