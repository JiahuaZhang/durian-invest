import { EMA } from 'technicalindicators';
import type { CandleData } from '../../context/ChartContext';
import type { MetaField } from '../meta';
import { getDefaultConfig, type DeriveConfig } from '../meta';

export const MarketBiasMeta = [
    { key: 'period', label: 'Period', group: 'HA Market Bias', type: 'number', default: 100, min: 1, max: 500 },
    { key: 'smoothing', label: 'Smoothing', group: 'HA Market Bias', type: 'number', default: 100, min: 1, max: 500 },
    { key: 'oscillatorPeriod', label: 'Oscillator Period', group: 'HA Market Bias', type: 'number', default: 7, min: 1, max: 100 },
    { key: 'showHACandles', label: 'Show HA Candles', group: 'Display Settings', type: 'boolean', default: true },
    { key: 'showMarketBias', label: 'Show Market Bias', group: 'Display Settings', type: 'boolean', default: true },
    { key: 'bullStrongColor', label: 'Bullish Strong', group: 'Display Settings', type: 'color', default: '#166534' },
    { key: 'bullWeakColor', label: 'Bullish Weak', group: 'Display Settings', type: 'color', default: '#4ADE80' },
    { key: 'bearStrongColor', label: 'Bearish Strong', group: 'Display Settings', type: 'color', default: '#991B1B' },
    { key: 'bearWeakColor', label: 'Bearish Weak', group: 'Display Settings', type: 'color', default: '#F87171' },
] as const satisfies readonly MetaField[];

export type MarketBiasConfig = DeriveConfig<typeof MarketBiasMeta>;

export const defaultMarketBiasConfig: MarketBiasConfig = getDefaultConfig(MarketBiasMeta);

export type MarketBiasState = 'bullStrong' | 'bullWeak' | 'bearStrong' | 'bearWeak' | 'neutral';

export type MarketBiasPoint = {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    avg: number;
    oscBias: number;
    oscSmooth: number;
    state: MarketBiasState;
    candleColor: string;
    biasColor: string;
};

function emaSeries(values: number[], period: number): number[] {
    if (values.length === 0) return [];

    const p = Math.max(1, period);
    if (p === 1) return [...values];

    const calculated = EMA.calculate({ period: p, values });
    if (calculated.length === 0) return [...values];

    const offset = values.length - calculated.length;
    const firstValue = calculated[0];

    return values.map((_, i) => (i < offset ? firstValue : calculated[i - offset]));
}

function toState(oscBias: number, oscSmooth: number): MarketBiasState {
    if (oscBias > 0 && oscBias >= oscSmooth) return 'bullStrong';
    if (oscBias > 0 && oscBias < oscSmooth) return 'bullWeak';
    if (oscBias < 0 && oscBias <= oscSmooth) return 'bearStrong';
    if (oscBias < 0 && oscBias > oscSmooth) return 'bearWeak';
    return 'neutral';
}

function toStateColor(state: MarketBiasState, config: MarketBiasConfig): string {
    switch (state) {
        case 'bullStrong':
            return config.bullStrongColor;
        case 'bullWeak':
            return config.bullWeakColor;
        case 'bearStrong':
            return config.bearStrongColor;
        case 'bearWeak':
            return config.bearWeakColor;
        case 'neutral':
        default:
            return '#94A3B8';
    }
}

export function computeMarketBiasData(
    candleData: CandleData[],
    config: MarketBiasConfig = defaultMarketBiasConfig
): MarketBiasPoint[] {
    if (candleData.length === 0) return [];

    const period = Math.max(1, config.period);
    const smoothing = Math.max(1, config.smoothing);
    const oscillatorPeriod = Math.max(1, config.oscillatorPeriod);

    const sourceOpen = candleData.map(d => d.open);
    const sourceHigh = candleData.map(d => d.high);
    const sourceLow = candleData.map(d => d.low);
    const sourceClose = candleData.map(d => d.close);

    const o = emaSeries(sourceOpen, period);
    const h = emaSeries(sourceHigh, period);
    const l = emaSeries(sourceLow, period);
    const c = emaSeries(sourceClose, period);

    const haClose = candleData.map((_, i) => (o[i] + h[i] + l[i] + c[i]) / 4);
    const xHaOpen = candleData.map((_, i) => (o[i] + c[i]) / 2);
    const haOpen = new Array<number>(candleData.length);
    const haHigh = new Array<number>(candleData.length);
    const haLow = new Array<number>(candleData.length);

    for (let i = 0; i < candleData.length; i++) {
        if (i === 0) {
            haOpen[i] = (o[i] + c[i]) / 2;
        } else {
            haOpen[i] = (xHaOpen[i - 1] + haClose[i - 1]) / 2;
        }

        haHigh[i] = Math.max(h[i], Math.max(haOpen[i], haClose[i]));
        haLow[i] = Math.min(l[i], Math.min(haOpen[i], haClose[i]));
    }

    const o2 = emaSeries(haOpen, smoothing);
    const h2 = emaSeries(haHigh, smoothing);
    const l2 = emaSeries(haLow, smoothing);
    const c2 = emaSeries(haClose, smoothing);
    const avg = candleData.map((_, i) => (h2[i] + l2[i]) / 2);

    const oscBias = candleData.map((_, i) => 100 * (c2[i] - o2[i]));
    const oscSmooth = emaSeries(oscBias, oscillatorPeriod);

    return candleData.map((d, i) => {
        const state = toState(oscBias[i], oscSmooth[i]);
        const color = toStateColor(state, config);

        return {
            time: d.time,
            open: o2[i],
            high: h2[i],
            low: l2[i],
            close: c2[i],
            avg: avg[i],
            oscBias: oscBias[i],
            oscSmooth: oscSmooth[i],
            state,
            candleColor: color,
            biasColor: color,
        };
    });
}
