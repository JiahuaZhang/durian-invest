import type { LineData, Time, WhitespaceData } from 'lightweight-charts';
import type { CandleData } from '../../context/ChartContext';
import type { MetaField } from '../meta';
import { getDefaultConfig, type DeriveConfig } from '../meta';

// ============================================================================
// Meta / Config
// ============================================================================

export const VWAPMeta = [
    { key: 'barsBack', label: 'Bars Back', group: 'Input', type: 'number', default: 150, min: 1, max: 5000, step: 1 },
    { key: 'columns', label: 'Columns (Bins)', group: 'Input', type: 'number', default: 35, min: 5, max: 200, step: 1 },
    { key: 'histWidth', label: 'Histogram Width (bars)', group: 'Input', type: 'number', default: 24, min: 6, max: 200, step: 1 },
    { key: 'valueAreaPct', label: 'Value Area %', group: 'Input', type: 'number', default: 70, min: 40, max: 99, step: 1 },
    { key: 'showPOC', label: 'Show POC Line', group: 'Input', type: 'boolean', default: true },
    { key: 'showVA', label: 'Show VAH/VAL Lines', group: 'Input', type: 'boolean', default: false },
    { key: 'showHistogram', label: 'Show Volume Profile Histogram', group: 'Input', type: 'boolean', default: true },
    { key: 'showVolumeLabels', label: 'Show Volume Labels', group: 'Input', type: 'boolean', default: true },
    { key: 'showVWAP', label: 'Show AVWAP Line', group: 'Input', type: 'boolean', default: true },
    { key: 'showValueAreaZone', label: 'Show Value Area Zone', group: 'Input', type: 'boolean', default: true },
    {
        key: 'pocWidth',
        label: 'POC Line Width',
        group: 'Style',
        type: 'select',
        default: 2,
        options: [
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
            { value: 4, label: '4' },
        ] as const,
    },
    {
        key: 'vaWidth',
        label: 'VA Line Width',
        group: 'Style',
        type: 'select',
        default: 1,
        options: [
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
            { value: 4, label: '4' },
        ] as const,
    },
    {
        key: 'vwapWidth',
        label: 'VWAP Line Width',
        group: 'Style',
        type: 'select',
        default: 2,
        options: [
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
            { value: 4, label: '4' },
        ] as const,
    },
    { key: 'pocColor', label: 'POC Color', group: 'Style', type: 'color', default: '#FF0000' },
    { key: 'vaColor', label: 'VAH/VAL Color', group: 'Style', type: 'color', default: '#FFA500' },
    { key: 'vwapColor', label: 'AVWAP Color', group: 'Style', type: 'color', default: '#2962FF' },
    { key: 'valueAreaBgColor', label: 'Value Area Background', group: 'Style', type: 'color', default: '#FFA50022' },
    { key: 'blockFillColor', label: 'Histogram Fill Color', group: 'Style', type: 'color', default: '#B0B0B0' },
    { key: 'blockFillOpacity', label: 'Histogram Fill Opacity %', group: 'Style', type: 'number', default: 70, min: 0, max: 100, step: 5 },
    { key: 'volumeLabelColor', label: 'Volume Label Color', group: 'Style', type: 'color', default: '#000000' },
] as const satisfies readonly MetaField[];

export type VWAPConfig = DeriveConfig<typeof VWAPMeta>;
export const defaultVWAPConfig: VWAPConfig = getDefaultConfig(VWAPMeta);

// ============================================================================
// Types
// ============================================================================

type RenderPoint = LineData<Time> | WhitespaceData<Time>;

export type VWAPZoneBand = {
    topPrice: number;
    bottomPrice: number;
    data: RenderPoint[];
};

export type VWAPComputation = {
    startIndex: number;
    pocPrice: number;
    vahPrice: number;
    valPrice: number;
};

/** Abbreviate volume for display (e.g. 960000000 -> "960M"). */
export function abbreviateValue(value: number): string {
    if (value === 0) return '0';
    const digitsAmt = Math.log10(Math.abs(value));
    if (digitsAmt > 12) return `${(value / 1e12).toFixed(0)}T`;
    if (digitsAmt > 9) return `${(value / 1e9).toFixed(0)}B`;
    if (digitsAmt > 6) return `${(value / 1e6).toFixed(0)}M`;
    if (digitsAmt > 3) return `${(value / 1e3).toFixed(0)}K`;
    return value.toFixed(0);
}

export type VWAPVolumeLabel = {
    time: Time;
    price: number;
    volume: number;
    label: string;
};

export type VWAPHistogramBin = {
    binLow: number;
    binHigh: number;
    volume: number;
    /** BaselineSeries data: two points defining the bar width at this price level */
    data: Array<{ time: Time; value: number; }>;
};

export type VWAPRenderData = {
    vwapLine: RenderPoint[];
    pocLine: RenderPoint[];
    vahLine: RenderPoint[];
    valLine: RenderPoint[];
    valueAreaBand: VWAPZoneBand | null;
    histogramBins: VWAPHistogramBin[];
    volumeLabels: VWAPVolumeLabel[];
    /** Synthetic time values for histogram region (for extending lines) */
    histStartTime: Time;
    histEndTime: Time;
};

// ============================================================================
// Computation  (ported from TradingView "THT Volume Pro" Pine Script)
// ============================================================================

function hlcc4(candle: CandleData): number {
    return (candle.high + candle.low + candle.close + candle.close) / 4;
}

/** Add N days to a "YYYY-MM-DD" string. */
function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * Compute volume profile, POC, Value Area, and running AVWAP over a lookback
 * window.  The algorithm mirrors the Pine Script logic:
 *
 *  1. Scan `barsBack` bars to find the price range and accumulate AVWAP.
 *  2. Divide the range into `columns` equal-height bins, accumulate volume.
 *  3. POC = bin with the highest volume.
 *  4. Value Area = expand outward from POC until cumulative volume reaches
 *     `valueAreaPct` % of total volume.
 *  5. AVWAP is a running cumulative line: Σ(hlcc4 × vol) / Σ(vol).
 */
export function computeVWAPData(
    candleData: CandleData[],
    config: VWAPConfig = defaultVWAPConfig,
): VWAPComputation & VWAPRenderData {
    const len = candleData.length;
    const blank = (): RenderPoint[] => candleData.map(c => ({ time: c.time as unknown as Time }));

    if (len < 2) {
        return {
            startIndex: 0, pocPrice: 0, vahPrice: 0, valPrice: 0,
            vwapLine: blank(), pocLine: blank(), vahLine: blank(), valLine: blank(),
            valueAreaBand: null,
            histogramBins: [],
            volumeLabels: [],
            histStartTime: candleData[0]?.time as unknown as Time,
            histEndTime: candleData[0]?.time as unknown as Time,
        };
    }

    const barsBack = Math.max(1, Math.min(config.barsBack, len));
    const cols = Math.max(5, Math.min(200, Math.round(config.columns)));
    const histWidth = Math.max(6, Math.min(200, Math.round(config.histWidth ?? 24)));
    const vaPct = Math.max(40, Math.min(99, config.valueAreaPct));
    const startIndex = len - barsBack;
    const lastTime = candleData[len - 1].time as string;

    // Synthetic times for histogram (to the right of last bar, like TradingView)
    const histStartTime = addDays(lastTime, 1) as unknown as Time;
    const histEndTime = addDays(lastTime, 1 + histWidth) as unknown as Time;

    // ── Pass 1: price range + anchored AVWAP (single value, not running) ──
    let pMin = Infinity;
    let pMax = -Infinity;
    let pvSum = 0;
    let vSum = 0;

    for (let i = startIndex; i < len; i++) {
        const c = candleData[i];
        pMin = Math.min(pMin, c.low);
        pMax = Math.max(pMax, c.high);
        pvSum += hlcc4(c) * c.volume;
        vSum += c.volume;
    }
    const anchoredVWAP = vSum > 0 ? pvSum / vSum : (pMin + pMax) / 2;

    // ── Pass 2: volume profile bins ──────────────────────────────────────
    if (pMax <= pMin) pMax = pMin + 1;
    const step = (pMax - pMin) / cols;

    const binVolumes = new Array<number>(cols).fill(0);
    const binLows = new Array<number>(cols);
    const binHighs = new Array<number>(cols);
    for (let i = 0; i < cols; i++) {
        binLows[i] = pMin + i * step;
        binHighs[i] = binLows[i] + step;
    }

    for (let i = startIndex; i < len; i++) {
        const pr = hlcc4(candleData[i]);
        const vol = candleData[i].volume;
        let idx = Math.floor((pr - pMin) / step);
        idx = Math.max(0, Math.min(cols - 1, idx));
        binVolumes[idx] += vol;
    }

    // ── POC ──────────────────────────────────────────────────────────────
    let pocIdx = 0;
    let pocVol = 0;
    let totalVol = 0;
    for (let i = 0; i < cols; i++) {
        totalVol += binVolumes[i];
        if (binVolumes[i] > pocVol) {
            pocVol = binVolumes[i];
            pocIdx = i;
        }
    }
    const pocPrice = (binLows[pocIdx] + binHighs[pocIdx]) / 2;

    // ── Value Area (expand from POC) ─────────────────────────────────────
    const targetVol = totalVol * (vaPct / 100);
    let left = pocIdx;
    let right = pocIdx;
    let cumVA = binVolumes[pocIdx];

    while (cumVA < targetVol && (left > 0 || right < cols - 1)) {
        const vLeft = left > 0 ? binVolumes[left - 1] : -1;
        const vRight = right < cols - 1 ? binVolumes[right + 1] : -1;
        if (vRight > vLeft) {
            right++;
            cumVA += binVolumes[right];
        } else if (vLeft >= 0) {
            left--;
            cumVA += binVolumes[left];
        } else {
            break;
        }
    }

    const vahPrice = binHighs[right];
    const valPrice = binLows[left];

    // ── Make horizontal line from profile start through histogram end ─────
    const makeFlatLine = (price: number): RenderPoint[] => {
        const points: RenderPoint[] = [];
        for (let i = 0; i < len; i++) {
            if (i >= startIndex) {
                points.push({ time: candleData[i].time as unknown as Time, value: price });
            } else {
                points.push({ time: candleData[i].time as unknown as Time });
            }
        }
        // Extend to histogram end (Pine: lines go from profileStart to histEnd)
        for (let d = 1; d <= histWidth + 1; d++) {
            points.push({ time: addDays(lastTime, d) as unknown as Time, value: price });
        }
        return points;
    };

    const pocLine = makeFlatLine(pocPrice);
    const vahLine = makeFlatLine(vahPrice);
    const valLine = makeFlatLine(valPrice);
    const vwapLine = makeFlatLine(anchoredVWAP);

    // Value Area zone band
    let valueAreaBand: VWAPZoneBand | null = null;
    if (vahPrice > valPrice) {
        valueAreaBand = {
            topPrice: vahPrice,
            bottomPrice: valPrice,
            data: makeFlatLine(vahPrice),
        };
    }

    // ── Histogram bins (Pine: box per bin, width ∝ volume) ───────────────
    const histogramBins: VWAPHistogramBin[] = [];
    const intoChart = true; // "Into chart (left)" = bars grow leftward from histEnd
    for (let i = 0; i < cols; i++) {
        const v = binVolumes[i];
        const lenPx = pocVol > 0 ? Math.round((v / pocVol) * histWidth) : 0;
        const px = Math.max(0, lenPx);
        const x1 = intoChart ? histWidth - px : 0;
        const x2 = intoChart ? histWidth : px;
        const t1 = addDays(lastTime, 1 + x1) as unknown as Time;
        const t2 = addDays(lastTime, 1 + x2) as unknown as Time;
        histogramBins.push({
            binLow: binLows[i],
            binHigh: binHighs[i],
            volume: v,
            data: [
                { time: t1, value: binHighs[i] },
                { time: t2, value: binHighs[i] },
            ],
        });
    }

    // Volume labels (at right edge of each bar, like TradingView)
    const volumeLabels: VWAPVolumeLabel[] = [];
    for (let i = 0; i < cols; i++) {
        const v = binVolumes[i];
        if (v <= 0) continue;
        const t2 = addDays(lastTime, 1 + histWidth) as unknown as Time;
        const price = (binLows[i] + binHighs[i]) / 2;
        volumeLabels.push({
            time: t2,
            price,
            volume: v,
            label: abbreviateValue(v),
        });
    }

    return {
        startIndex, pocPrice, vahPrice, valPrice,
        vwapLine, pocLine, vahLine, valLine, valueAreaBand,
        histogramBins,
        volumeLabels,
        histStartTime,
        histEndTime,
    };
}
