import type { LineData, Time, WhitespaceData } from 'lightweight-charts';
import { ATR } from 'technicalindicators';
import type { CandleData } from '../../context/ChartContext';
import type { MetaField } from '../meta';
import { getDefaultConfig, type DeriveConfig } from '../meta';

export const fibonacciRetracementLevelOrder = [
    'level0',
    'level236',
    'level382',
    'level5',
    'level618',
    'level786',
    'level1',
] as const;

export const fibonacciRetracementBandOrder = [
    'zone0_236',
    'zone236_382',
    'zone382_5',
    'zone5_618',
    'zone618_786',
    'zone786_1',
] as const;

// Backward-compatible alias used by context wiring.
export const fibonacciLevelOrder = fibonacciRetracementLevelOrder;

export type RetracementLevelKey = typeof fibonacciRetracementLevelOrder[number];
export type RetracementBandKey = typeof fibonacciRetracementBandOrder[number];

const RETRACEMENT_RATIOS: Record<RetracementLevelKey, number> = {
    level0: 0,
    level236: 0.236,
    level382: 0.382,
    level5: 0.5,
    level618: 0.618,
    level786: 0.786,
    level1: 1,
};


export const FibonacciMeta = [
    { key: 'trendOn', label: 'Show Supertrend', group: 'Input', type: 'boolean', default: true },
    { key: 'trendFactor', label: 'Supertrend Factor', group: 'Input', type: 'number', default: 4, min: 0.1, max: 20, step: 0.1 },
    { key: 'trendPeriod', label: 'Supertrend ATR Period', group: 'Input', type: 'number', default: 25, min: 1, max: 500 },
    { key: 'bullColor', label: 'Bullish Trend Color', group: 'Style', type: 'color', default: '#51a2ff' },
    { key: 'bearColor', label: 'Bearish Trend Color', group: 'Style', type: 'color', default: '#c27aff' },
    {
        key: 'historyMode',
        label: 'Historical Ranges',
        group: 'Input',
        type: 'select',
        default: 1,
        options: [
            { value: 0, label: 'None' },
            { value: 1, label: 'Last Trend Only' },
            { value: 2, label: 'All Trends' },
        ] as const,
    },
    { key: 'showRetracement', label: 'Show Retracement', group: 'Input', type: 'boolean', default: true },
    { key: 'showTrendline', label: 'Show Diagonal Trendline', group: 'Input', type: 'boolean', default: true },
    { key: 'showMidline', label: 'Show 0.5 Midline', group: 'Input', type: 'boolean', default: true },
    {
        key: 'lineWidth',
        label: 'Range Line Width',
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
    { key: 'level0LineColor', label: '0 Line', group: 'Style', type: 'color', default: '#787b86' },
    { key: 'level236LineColor', label: '0.236 Line', group: 'Style', type: 'color', default: '#f23645' },
    { key: 'level382LineColor', label: '0.382 Line', group: 'Style', type: 'color', default: '#ff9800' },
    { key: 'level5LineColor', label: '0.5 Line', group: 'Style', type: 'color', default: '#4caf50' },
    { key: 'level618LineColor', label: '0.618 Line', group: 'Style', type: 'color', default: '#26a69a' },
    { key: 'level786LineColor', label: '0.786 Line', group: 'Style', type: 'color', default: '#2196f3' },
    { key: 'level1LineColor', label: '1 Line', group: 'Style', type: 'color', default: '#787b86' },
    { key: 'level0BgColor', label: '0 Background', group: 'Style', type: 'color', default: '#f2364522' },
    { key: 'level236BgColor', label: '0.236 Background', group: 'Style', type: 'color', default: '#ff572222' },
    { key: 'level382BgColor', label: '0.382 Background', group: 'Style', type: 'color', default: '#ff980022' },
    { key: 'level5BgColor', label: '0.5 Background', group: 'Style', type: 'color', default: '#4caf5022' },
    { key: 'level618BgColor', label: '0.618 Background', group: 'Style', type: 'color', default: '#26a69a22' },
    { key: 'level786BgColor', label: '0.786 Background', group: 'Style', type: 'color', default: '#2196f322' },
    { key: 'level1BgColor', label: '1 Background', group: 'Style', type: 'color', default: '#9e9e9e22' },
] as const satisfies readonly MetaField[];

export type FibonacciConfig = DeriveConfig<typeof FibonacciMeta>;
export const defaultFibonacciConfig: FibonacciConfig = getDefaultConfig(FibonacciMeta);

export type FibonacciHistoryMode = 0 | 1 | 2;
export type TrendDirection = 1 | -1;

export type FibonacciRetracementLevels = Record<RetracementLevelKey, number>;

export type FibonacciSegment = {
    trend: TrendDirection;
    startIndex: number;
    endIndex: number;
    low: number;
    lowIndex: number;
    high: number;
    highIndex: number;
    levels: FibonacciRetracementLevels;
};

export type FibonacciComputation = {
    supertrend: Array<{
        time: string;
        value: number;
        direction: TrendDirection;
    }>;
    segments: FibonacciSegment[];
};

type RenderPoint = LineData<Time> | WhitespaceData<Time>;

export type FibonacciZoneBand = {
    topPrice: number;
    bottomPrice: number;
    data: Array<LineData<Time> | WhitespaceData<Time>>;
};

export type FibonacciRenderData = {
    supertrendData: LineData<Time>[];
    retracementData: Record<RetracementLevelKey, RenderPoint[]>;
    retracementZoneBands: Record<RetracementBandKey, FibonacciZoneBand[]>;
    trendlineSegments: LineData<Time>[][];
};

const retracementLineColorKey: Record<RetracementLevelKey, keyof FibonacciConfig> = {
    level0: 'level0LineColor',
    level236: 'level236LineColor',
    level382: 'level382LineColor',
    level5: 'level5LineColor',
    level618: 'level618LineColor',
    level786: 'level786LineColor',
    level1: 'level1LineColor',
};

const retracementBgColorKey: Record<RetracementBandKey, keyof FibonacciConfig> = {
    zone0_236: 'level236BgColor',
    zone236_382: 'level382BgColor',
    zone382_5: 'level5BgColor',
    zone5_618: 'level618BgColor',
    zone618_786: 'level786BgColor',
    zone786_1: 'level1BgColor',
};

export function getRetracementLineColor(config: FibonacciConfig, key: RetracementLevelKey): string {
    return config[retracementLineColorKey[key]] as string;
}

export function getRetracementBgColor(config: FibonacciConfig, key: RetracementBandKey): string {
    return config[retracementBgColorKey[key]] as string;
}

export function getFibonacciHistoryModeLabel(mode: number): string {
    if (mode === 0) return 'None';
    if (mode === 2) return 'All';
    return 'Last';
}

function normalizeHistoryMode(mode: number): FibonacciHistoryMode {
    if (mode === 0 || mode === 2) return mode;
    return 1;
}

function computeAtr(candleData: CandleData[], period: number): number[] {
    if (candleData.length === 0) return [];
    if (candleData.length === 1) {
        return [Math.max(candleData[0].high - candleData[0].low, 0)];
    }

    const p = Math.max(1, Math.min(Math.floor(period), candleData.length - 1));
    const atrValues = ATR.calculate({
        high: candleData.map(c => c.high),
        low: candleData.map(c => c.low),
        close: candleData.map(c => c.close),
        period: p,
    });

    if (atrValues.length === 0) {
        const range = Math.max(candleData[0].high - candleData[0].low, 0);
        return new Array(candleData.length).fill(range);
    }

    const offset = candleData.length - atrValues.length;
    const seed = atrValues[0];
    return candleData.map((_, index) => (index < offset ? seed : atrValues[index - offset]));
}

function computeSupertrend(candleData: CandleData[], factor: number, atrPeriod: number) {
    const atr = computeAtr(candleData, atrPeriod);
    const supertrend = new Array<number>(candleData.length).fill(0);
    const direction = new Array<TrendDirection>(candleData.length).fill(1);

    if (candleData.length === 0) {
        return { supertrend, direction };
    }

    const firstHl2 = (candleData[0].high + candleData[0].low) / 2;
    let finalUpperPrev = firstHl2 + factor * atr[0];
    let finalLowerPrev = firstHl2 - factor * atr[0];
    direction[0] = candleData[0].close <= finalUpperPrev ? 1 : -1;
    supertrend[0] = direction[0] === 1 ? finalUpperPrev : finalLowerPrev;

    for (let i = 1; i < candleData.length; i++) {
        const hl2 = (candleData[i].high + candleData[i].low) / 2;
        const basicUpper = hl2 + factor * atr[i];
        const basicLower = hl2 - factor * atr[i];

        const finalUpper =
            basicUpper < finalUpperPrev || candleData[i - 1].close > finalUpperPrev
                ? basicUpper
                : finalUpperPrev;

        const finalLower =
            basicLower > finalLowerPrev || candleData[i - 1].close < finalLowerPrev
                ? basicLower
                : finalLowerPrev;

        if (direction[i - 1] === 1) {
            direction[i] = candleData[i].close > finalUpper ? -1 : 1;
        } else {
            direction[i] = candleData[i].close < finalLower ? 1 : -1;
        }

        supertrend[i] = direction[i] === 1 ? finalUpper : finalLower;
        finalUpperPrev = finalUpper;
        finalLowerPrev = finalLower;
    }

    return { supertrend, direction };
}

function buildRetracementLevels(level0: number, level1: number): FibonacciRetracementLevels {
    const distance = level1 - level0;
    return {
        level0,
        level236: level0 + distance * RETRACEMENT_RATIOS.level236,
        level382: level0 + distance * RETRACEMENT_RATIOS.level382,
        level5: level0 + distance * RETRACEMENT_RATIOS.level5,
        level618: level0 + distance * RETRACEMENT_RATIOS.level618,
        level786: level0 + distance * RETRACEMENT_RATIOS.level786,
        level1,
    };
}

function buildSegment(
    candleData: CandleData[],
    startIndex: number,
    endIndex: number,
    trend: TrendDirection,
): FibonacciSegment {
    let low = Number.POSITIVE_INFINITY;
    let lowIndex = startIndex;
    let high = Number.NEGATIVE_INFINITY;
    let highIndex = startIndex;

    for (let i = startIndex; i <= endIndex; i++) {
        const candle = candleData[i];
        if (candle.low < low) {
            low = candle.low;
            lowIndex = i;
        }
        if (candle.high > high) {
            high = candle.high;
            highIndex = i;
        }
    }

    const level0 = trend === 1 ? low : high;
    const level1 = trend === 1 ? high : low;

    return {
        trend,
        startIndex,
        endIndex,
        low,
        lowIndex,
        high,
        highIndex,
        levels: buildRetracementLevels(level0, level1),
    };
}


function createEmptyRetracementData(candleData: CandleData[]): Record<RetracementLevelKey, RenderPoint[]> {
    return {
        level0: candleData.map(candle => ({ time: candle.time as unknown as Time })),
        level236: candleData.map(candle => ({ time: candle.time as unknown as Time })),
        level382: candleData.map(candle => ({ time: candle.time as unknown as Time })),
        level5: candleData.map(candle => ({ time: candle.time as unknown as Time })),
        level618: candleData.map(candle => ({ time: candle.time as unknown as Time })),
        level786: candleData.map(candle => ({ time: candle.time as unknown as Time })),
        level1: candleData.map(candle => ({ time: candle.time as unknown as Time })),
    };
}

function buildZoneBand(
    candleData: CandleData[],
    startIndex: number,
    endIndex: number,
    topPrice: number,
    bottomPrice: number,
): FibonacciZoneBand {
    const data: Array<LineData<Time> | WhitespaceData<Time>> = candleData.map((candle, i) => {
        if (i >= startIndex && i <= endIndex) {
            return { time: candle.time as unknown as Time, value: topPrice };
        }
        return { time: candle.time as unknown as Time };
    });
    return { topPrice, bottomPrice, data };
}

function getVisibleSegments(segments: FibonacciSegment[], mode: FibonacciHistoryMode): FibonacciSegment[] {
    if (mode === 0) return [];
    if (mode === 1) {
        return segments.length > 0 ? [segments[segments.length - 1]] : [];
    }
    return segments;
}



export function computeFibonacciData(
    candleData: CandleData[],
    config: FibonacciConfig = defaultFibonacciConfig,
): FibonacciComputation {
    if (candleData.length === 0) {
        return { supertrend: [], segments: [] };
    }

    const trendFactor = Math.max(0.1, config.trendFactor);
    const trendPeriod = Math.max(1, Math.floor(config.trendPeriod));
    const { supertrend, direction } = computeSupertrend(candleData, trendFactor, trendPeriod);

    const segments: FibonacciSegment[] = [];
    let segmentStart = 0;

    for (let i = 1; i <= direction.length; i++) {
        const reachedEnd = i === direction.length;
        const changed = !reachedEnd && direction[i] !== direction[i - 1];

        if (!reachedEnd && !changed) continue;

        const segmentEnd = i - 1;
        const trend = direction[segmentEnd];
        segments.push(buildSegment(candleData, segmentStart, segmentEnd, trend));
        segmentStart = i;
    }

    return {
        supertrend: candleData.map((candle, index) => ({
            time: candle.time,
            value: supertrend[index],
            direction: direction[index],
        })),
        segments,
    };
}

export function buildFibonacciRenderData(
    candleData: CandleData[],
    computed: FibonacciComputation,
    config: FibonacciConfig = defaultFibonacciConfig,
): FibonacciRenderData {
    const historyMode = normalizeHistoryMode(config.historyMode);
    const visibleSegments = getVisibleSegments(computed.segments, historyMode);

    const supertrendData: LineData<Time>[] = config.trendOn
        ? computed.supertrend.map(point => ({
            time: point.time as unknown as Time,
            value: point.value,
            color: point.direction === 1 ? config.bearColor : config.bullColor,
        }))
        : [];

    const retracementData = createEmptyRetracementData(candleData);
    const retracementZoneBands: Record<RetracementBandKey, FibonacciZoneBand[]> = {
        zone0_236: [], zone236_382: [], zone382_5: [],
        zone5_618: [], zone618_786: [], zone786_1: [],
    };
    const retracementBandPairs: Array<[RetracementBandKey, RetracementLevelKey, RetracementLevelKey]> = [
        ['zone0_236', 'level0', 'level236'],
        ['zone236_382', 'level236', 'level382'],
        ['zone382_5', 'level382', 'level5'],
        ['zone5_618', 'level5', 'level618'],
        ['zone618_786', 'level618', 'level786'],
        ['zone786_1', 'level786', 'level1'],
    ];
    const trendlineSegments: LineData<Time>[][] = [];

    if (config.showRetracement || config.showTrendline) {
        visibleSegments.forEach((segment) => {
            const clipStart = segment.startIndex;
            const clipEnd = segment.endIndex;
            if (clipStart > clipEnd) return;

            if (config.showRetracement) {
                for (const key of fibonacciRetracementLevelOrder) {
                    if (key === 'level5' && !config.showMidline) continue;
                    const level = segment.levels[key];
                    for (let i = clipStart; i <= clipEnd; i++) {
                        retracementData[key][i] = { time: candleData[i].time as unknown as Time, value: level };
                    }
                }
                for (const [bandKey, lowKey, highKey] of retracementBandPairs) {
                    const top = Math.max(segment.levels[lowKey], segment.levels[highKey]);
                    const bottom = Math.min(segment.levels[lowKey], segment.levels[highKey]);
                    retracementZoneBands[bandKey].push(buildZoneBand(candleData, clipStart, clipEnd, top, bottom));
                }
            }

            if (config.showTrendline) {
                if (segment.lowIndex !== segment.highIndex) {
                    const sIdx = Math.min(segment.lowIndex, segment.highIndex);
                    const eIdx = Math.max(segment.lowIndex, segment.highIndex);
                    const sVal = sIdx === segment.lowIndex ? segment.low : segment.high;
                    const eVal = eIdx === segment.lowIndex ? segment.low : segment.high;
                    const span = eIdx - sIdx;
                    const segLine: LineData<Time>[] = [];
                    for (let i = sIdx; i <= eIdx; i++) {
                        const t = span === 0 ? 0 : (i - sIdx) / span;
                        segLine.push({ time: candleData[i].time as unknown as Time, value: sVal + (eVal - sVal) * t });
                    }
                    trendlineSegments.push(segLine);
                }
            }
        });
    }

    return { supertrendData, retracementData, retracementZoneBands, trendlineSegments };
}
