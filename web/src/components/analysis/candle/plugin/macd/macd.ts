import { MACD } from 'technicalindicators';
import type { CandleData } from '../../context/ChartContext';
import type { MetaField } from '../meta';
import { getDefaultConfig, type DeriveConfig } from '../meta';

// ── Meta definition (single source of truth) ─────────────────────────────

export const MACDMeta = [
    // Inputs
    { key: 'fastPeriod', label: 'Fast Period', group: 'Inputs', type: 'number', default: 12, min: 2, max: 50 },
    { key: 'slowPeriod', label: 'Slow Period', group: 'Inputs', type: 'number', default: 26, min: 2, max: 100 },
    { key: 'signalPeriod', label: 'Signal Period', group: 'Inputs', type: 'number', default: 9, min: 2, max: 50 },
    // Style
    { key: 'macdColor', label: 'MACD Line', group: 'Style', type: 'color', default: '#2962FF' },
    { key: 'signalColor', label: 'Signal Line', group: 'Style', type: 'color', default: '#FF6D00' },
    { key: 'histogramUpColor', label: 'Histogram Up', group: 'Style', type: 'color', default: '#26a69a' },
    { key: 'histogramDownColor', label: 'Histogram Down', group: 'Style', type: 'color', default: '#ef5350' },
    // Divergence
    { key: 'showDivergences', label: 'Show Divergences', group: 'Divergence', type: 'boolean', default: false },
    { key: 'divergenceBullColor', label: 'Bull Color', group: 'Divergence', type: 'color', default: '#26A69A' },
    { key: 'divergenceBearColor', label: 'Bear Color', group: 'Divergence', type: 'color', default: '#EF5350' },
    { key: 'pivotLookbackLeft', label: 'Lookback Left', group: 'Divergence', type: 'number', default: 20, min: 1, max: 20 },
    { key: 'pivotLookbackRight', label: 'Lookback Right', group: 'Divergence', type: 'number', default: 0, min: 0, max: 20 },
    { key: 'rangeMin', label: 'Range Min', group: 'Divergence', type: 'number', default: 5, min: 1, max: 100 },
    { key: 'rangeMax', label: 'Range Max', group: 'Divergence', type: 'number', default: 60, min: 10, max: 200 },
    { key: 'dontTouchZero', label: "Don't Touch Zero", group: 'Divergence', type: 'boolean', default: true },
] as const satisfies readonly MetaField[];

// ── Derived config type ──────────────────────────────────────────────────

export type MACDConfig = DeriveConfig<typeof MACDMeta>;

// ── Default config ───────────────────────────────────────────────────────

export const defaultMACDConfig: MACDConfig = getDefaultConfig(MACDMeta);

export type MACDData = {
    time: string;
    macd?: number;
    signal?: number;
    histogram?: number;
};

export type MACDCross = {
    date: string;
    type: 'golden' | 'dead';
    macdValue: number;
    daysSinceLastCross?: number;
};

export type Pivot = {
    index: number;
    date: string;
    price: number;
    macd: number;
    type: 'high' | 'low';
};

export type MACDDivergence = {
    type: 'bullish' | 'bearish';
    startIndex: number;
    endIndex: number;
    startDate: string;
    endDate: string;
    startPrice: number;
    endPrice: number;
    startMacd: number;
    endMacd: number;
};

export type DivergenceConfig = {
    pivotLookbackLeft: number;
    pivotLookbackRight: number;
    rangeMin: number;
    rangeMax: number;
    dontTouchZero: boolean;
};

export function calcMACD(
    data: CandleData[],
    config: { fast: number; slow: number; signal: number; } = { fast: 12, slow: 26, signal: 9 }
): MACDData[] {
    const result = MACD.calculate({
        values: data.map(d => d.close),
        fastPeriod: config.fast,
        slowPeriod: config.slow,
        signalPeriod: config.signal,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    });

    const offset = data.length - result.length;
    return data.map((d, i) => ({
        time: d.time,
        macd: result[i - offset]?.MACD,
        signal: result[i - offset]?.signal,
        histogram: result[i - offset]?.histogram,
    }));
}

export function findMACDCrosses(macdData: MACDData[]): MACDCross[] {
    const crosses: MACDCross[] = [];

    for (let i = 1; i < macdData.length; i++) {
        const prev = macdData[i - 1];
        const curr = macdData[i];

        if (prev.macd === undefined || prev.signal === undefined ||
            curr.macd === undefined || curr.signal === undefined) continue;

        const prevDiff = prev.macd - prev.signal;
        const currDiff = curr.macd - curr.signal;

        if (prevDiff <= 0 && currDiff > 0) {
            crosses.push({ date: curr.time, type: 'golden', macdValue: curr.macd });
        } else if (prevDiff >= 0 && currDiff < 0) {
            crosses.push({ date: curr.time, type: 'dead', macdValue: curr.macd });
        }
    }

    for (let i = 1; i < crosses.length; i++) {
        const prev = new Date(crosses[i - 1].date);
        const curr = new Date(crosses[i].date);
        crosses[i].daysSinceLastCross = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    }

    return crosses.reverse();
}

function findPivots(
    data: CandleData[],
    macdData: MACDData[],
    lookbackLeft: number,
    lookbackRight: number
): Pivot[] {
    const pivots: Pivot[] = [];

    for (let i = lookbackLeft; i < data.length - lookbackRight; i++) {
        const macd = macdData[i].macd;
        if (macd === undefined) continue;

        const lowPrice = data[i].low;
        const highPrice = data[i].high;

        let isLow = true;
        let isHigh = true;

        // Check left side
        for (let j = 1; j <= lookbackLeft; j++) {
            if (data[i - j].low < lowPrice) isLow = false;
            if (data[i - j].high > highPrice) isHigh = false;
        }

        // Check right side
        for (let j = 1; j <= lookbackRight; j++) {
            if (data[i + j].low < lowPrice) isLow = false;
            if (data[i + j].high > highPrice) isHigh = false;
        }

        if (isLow) {
            pivots.push({ index: i, date: data[i].time, price: lowPrice, macd, type: 'low' });
        }
        if (isHigh) {
            pivots.push({ index: i, date: data[i].time, price: highPrice, macd, type: 'high' });
        }
    }

    return pivots;
}

const defaultDivergenceConfig: DivergenceConfig = {
    pivotLookbackLeft: 5,
    pivotLookbackRight: 5,
    rangeMin: 5,
    rangeMax: 60,
    dontTouchZero: true,
};

export function findMACDDivergences(
    data: CandleData[],
    macdData: MACDData[],
    config: Partial<DivergenceConfig> = {}
): MACDDivergence[] {
    const { pivotLookbackLeft, pivotLookbackRight, rangeMin, rangeMax, dontTouchZero } = {
        ...defaultDivergenceConfig,
        ...config,
    };

    const pivots = findPivots(data, macdData, pivotLookbackLeft, pivotLookbackRight);
    const divergences: MACDDivergence[] = [];

    const lows = pivots.filter(p => p.type === 'low');
    const highs = pivots.filter(p => p.type === 'high');

    // Helper: check if MACD crosses zero between two indices
    const crossesZero = (startIdx: number, endIdx: number): boolean => {
        let hasPositive = false;
        let hasNegative = false;
        for (let i = startIdx; i <= endIdx; i++) {
            const macd = macdData[i]?.macd;
            if (macd === undefined) continue;
            if (macd > 0) hasPositive = true;
            if (macd < 0) hasNegative = true;
        }
        return hasPositive && hasNegative;
    };

    // Helper: check if bars are within range
    const inRange = (startIdx: number, endIdx: number): boolean => {
        const bars = endIdx - startIdx;
        return bars >= rangeMin && bars <= rangeMax;
    };

    // Bullish divergence: price lower low, MACD higher low (MACD below zero)
    for (let i = 1; i < lows.length; i++) {
        const prev = lows[i - 1];
        const curr = lows[i];

        if (!inRange(prev.index, curr.index)) continue;

        // Price makes lower low
        const priceLL = curr.price < prev.price;
        // MACD makes higher low
        const oscHL = curr.macd > prev.macd && curr.macd < 0;

        // Don't touch zero check: MACD should stay below zero
        const zeroCheck = dontTouchZero ? !crossesZero(prev.index, curr.index) : true;

        if (priceLL && oscHL && zeroCheck) {
            divergences.push({
                type: 'bullish',
                startIndex: prev.index,
                endIndex: curr.index,
                startDate: prev.date,
                endDate: curr.date,
                startPrice: prev.price,
                endPrice: curr.price,
                startMacd: prev.macd,
                endMacd: curr.macd,
            });
        }
    }

    // Bearish divergence: price higher high, MACD lower high (MACD above zero)
    for (let i = 1; i < highs.length; i++) {
        const prev = highs[i - 1];
        const curr = highs[i];

        if (!inRange(prev.index, curr.index)) continue;

        // Price makes higher high
        const priceHH = curr.price > prev.price;
        // MACD makes lower high
        const oscLH = curr.macd < prev.macd && curr.macd > 0;

        // Don't touch zero check: MACD should stay above zero
        const zeroCheck = dontTouchZero ? !crossesZero(prev.index, curr.index) : true;

        if (priceHH && oscLH && zeroCheck) {
            divergences.push({
                type: 'bearish',
                startIndex: prev.index,
                endIndex: curr.index,
                startDate: prev.date,
                endDate: curr.date,
                startPrice: prev.price,
                endPrice: curr.price,
                startMacd: prev.macd,
                endMacd: curr.macd,
            });
        }
    }

    return divergences.sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
}
