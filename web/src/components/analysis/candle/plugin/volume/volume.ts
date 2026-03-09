import { createChart, HistogramSeries } from 'lightweight-charts';
import type { CandleData } from '../../context/ChartContext';
import type { MetaField } from '../meta';
import { getDefaultConfig, type DeriveConfig } from '../meta';

// ── Meta definition (single source of truth) ─────────────────────────────

export const VolumeMeta = [
    { key: 'upColor', label: 'Up Color', group: 'Style', type: 'color', default: '#26a69a' },
    { key: 'downColor', label: 'Down Color', group: 'Style', type: 'color', default: '#ef5350' },
] as const satisfies readonly MetaField[];

// ── Derived config type ──────────────────────────────────────────────────

export type VolumeConfig = DeriveConfig<typeof VolumeMeta>;

// ── Default config ───────────────────────────────────────────────────────

export const defaultVolumeConfig: VolumeConfig = getDefaultConfig(VolumeMeta);

// ── Data computation ─────────────────────────────────────────────────────

export function computeVolumeData(candleData: CandleData[], config: VolumeConfig) {
    return candleData.map(d => ({
        time: d.time,
        value: d.volume,
        color: d.close >= d.open ? config.upColor : config.downColor,
    }));
}

// ── Series creation ──────────────────────────────────────────────────────

export function createVolumeSeries(chart: ReturnType<typeof createChart>) {
    return chart.addSeries(HistogramSeries, {
        priceScaleId: '',
        lastValueVisible: false,
        priceLineVisible: false,
    });
}
