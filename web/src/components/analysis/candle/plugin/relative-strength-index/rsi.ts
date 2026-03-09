import { BollingerBands, EMA, RSI, SMA, WEMA, WMA } from 'technicalindicators';
import type { CandleData } from '../../context/ChartContext';
import type { MetaField } from '../meta';
import { getDefaultConfig, type DeriveConfig } from '../meta';

export const RSISource = {
    Close: 0,
    Open: 1,
    High: 2,
    Low: 3,
    HL2: 4,
    HLC3: 5,
    OHLC4: 6,
} as const;

export const RSISmoothing = {
    None: 0,
    SMA: 1,
    SMABB: 2,
    EMA: 3,
    RMA: 4,
    WMA: 5,
    VWMA: 6,
} as const;

export const RSIMeta = [
    // Inputs
    { key: 'period', label: 'RSI Length', group: 'Inputs', type: 'number', default: 14, min: 1, max: 500 },
    {
        key: 'source',
        label: 'Source',
        group: 'Inputs',
        type: 'select',
        default: RSISource.Close,
        options: [
            { value: RSISource.Close, label: 'Close' },
            { value: RSISource.Open, label: 'Open' },
            { value: RSISource.High, label: 'High' },
            { value: RSISource.Low, label: 'Low' },
            { value: RSISource.HL2, label: 'HL2' },
            { value: RSISource.HLC3, label: 'HLC3' },
            { value: RSISource.OHLC4, label: 'OHLC4' },
        ] as const,
    },
    { key: 'overbought', label: 'Overbought', group: 'Inputs', type: 'number', default: 70, min: 1, max: 100 },
    { key: 'middle', label: 'Middle', group: 'Inputs', type: 'number', default: 50, min: 1, max: 100 },
    { key: 'oversold', label: 'Oversold', group: 'Inputs', type: 'number', default: 30, min: 1, max: 100 },
    { key: 'showMiddleLine', label: 'Show Middle', group: 'Inputs', type: 'boolean', default: true },
    {
        key: 'smoothingType',
        label: 'Type',
        group: 'Inputs',
        type: 'select',
        default: RSISmoothing.SMA,
        options: [
            { value: RSISmoothing.None, label: 'None' },
            { value: RSISmoothing.SMA, label: 'SMA' },
            { value: RSISmoothing.SMABB, label: 'SMA + BB' },
            { value: RSISmoothing.EMA, label: 'EMA' },
            { value: RSISmoothing.RMA, label: 'SMMA (RMA)' },
            { value: RSISmoothing.WMA, label: 'WMA' },
            { value: RSISmoothing.VWMA, label: 'VWMA' },
        ] as const,
    },
    { key: 'smoothingLength', label: 'Length', group: 'Inputs', type: 'number', default: 14, min: 1, max: 200 },
    { key: 'bbStdDev', label: 'BB StdDev', group: 'Inputs', type: 'number', default: 2, min: 1, max: 10 },
    // Divergence
    { key: 'showDivergences', label: 'Show Divergences', group: 'Divergence', type: 'boolean', default: false },
    { key: 'pivotLookbackRight', label: 'Lookback Right', group: 'Divergence', type: 'number', default: 0, min: 0, max: 20 },
    { key: 'pivotLookbackLeft', label: 'Lookback Left', group: 'Divergence', type: 'number', default: 20, min: 1, max: 20 },
    { key: 'rangeMin', label: 'Range Min', group: 'Divergence', type: 'number', default: 5, min: 1, max: 100 },
    { key: 'rangeMax', label: 'Range Max', group: 'Divergence', type: 'number', default: 60, min: 2, max: 200 },
    { key: 'plotBullish', label: 'Regular Bullish', group: 'Divergence', type: 'boolean', default: true },
    { key: 'plotHiddenBullish', label: 'Hidden Bullish', group: 'Divergence', type: 'boolean', default: true },
    { key: 'plotBearish', label: 'Regular Bearish', group: 'Divergence', type: 'boolean', default: true },
    { key: 'plotHiddenBearish', label: 'Hidden Bearish', group: 'Divergence', type: 'boolean', default: false },
    { key: 'divergenceBullColor', label: 'Bull Color', group: 'Divergence', type: 'color', default: '#26A69A' },
    { key: 'divergenceHiddenBullColor', label: 'Hidden Bull Color', group: 'Divergence', type: 'color', default: '#7CC8A6' },
    { key: 'divergenceBearColor', label: 'Bear Color', group: 'Divergence', type: 'color', default: '#8D1699' },
    { key: 'divergenceHiddenBearColor', label: 'Hidden Bear Color', group: 'Divergence', type: 'color', default: '#EF5350' },
    // Style
    { key: 'smoothingColor', label: 'Smoothing Color', group: 'Style', type: 'color', default: '#FF6D00' },
    { key: 'bbColor', label: 'BB Color', group: 'Style', type: 'color', default: '#94A3B8' },
    { key: 'rsiColor', label: 'RSI Line', group: 'Style', type: 'color', default: '#7E57C2' },
    {
        key: 'rsiLineWidth',
        label: 'RSI Width',
        group: 'Style',
        type: 'select',
        default: 1,
        options: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }] as const,
    },
    { key: 'overboughtColor', label: 'Overbought Color', group: 'Style', type: 'color', default: '#787B86' },
    { key: 'middleColor', label: 'Middle Color', group: 'Style', type: 'color', default: '#B2B5BE' },
    { key: 'oversoldColor', label: 'Oversold Color', group: 'Style', type: 'color', default: '#787B86' },
    {
        key: 'levelLineWidth',
        label: 'Level Width',
        group: 'Style',
        type: 'select',
        default: 1,
        options: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }] as const,
    },
] as const satisfies readonly MetaField[];

export type RSIConfig = DeriveConfig<typeof RSIMeta>;

export const defaultRSIConfig: RSIConfig = getDefaultConfig(RSIMeta);

export type RSIData = {
    time: string;
    value?: number;
    ma?: number;
    bbUpper?: number;
    bbLower?: number;
};

export type RSIPivot = {
    index: number;
    date: string;
    price: number;
    rsi: number;
    type: 'high' | 'low';
};

export type RSIDivergenceType = 'bullish' | 'hiddenBullish' | 'bearish' | 'hiddenBearish';

export type RSIDivergence = {
    type: RSIDivergenceType;
    startIndex: number;
    endIndex: number;
    startDate: string;
    endDate: string;
    startPrice: number;
    endPrice: number;
    startRsi: number;
    endRsi: number;
};

export type RSIDivergenceConfig = {
    pivotLookbackRight: number;
    pivotLookbackLeft: number;
    rangeMin: number;
    rangeMax: number;
    plotBullish: boolean;
    plotHiddenBullish: boolean;
    plotBearish: boolean;
    plotHiddenBearish: boolean;
};

const defaultDivergenceConfig: RSIDivergenceConfig = {
    pivotLookbackRight: 3,
    pivotLookbackLeft: 1,
    rangeMin: 5,
    rangeMax: 60,
    plotBullish: true,
    plotHiddenBullish: true,
    plotBearish: true,
    plotHiddenBearish: false,
};

export function getRSISourceLabel(source: number): string {
    switch (source) {
        case RSISource.Close: return 'close';
        case RSISource.Open: return 'open';
        case RSISource.High: return 'high';
        case RSISource.Low: return 'low';
        case RSISource.HL2: return 'hl2';
        case RSISource.HLC3: return 'hlc3';
        case RSISource.OHLC4: return 'ohlc4';
        default: return 'close';
    }
}

function getSourceValue(candle: CandleData, source: number): number {
    switch (source) {
        case RSISource.Open:
            return candle.open;
        case RSISource.High:
            return candle.high;
        case RSISource.Low:
            return candle.low;
        case RSISource.HL2:
            return (candle.high + candle.low) / 2;
        case RSISource.HLC3:
            return (candle.high + candle.low + candle.close) / 3;
        case RSISource.OHLC4:
            return (candle.open + candle.high + candle.low + candle.close) / 4;
        case RSISource.Close:
        default:
            return candle.close;
    }
}

// technicalindicators exposes VWAP but not rolling VWMA, so this stays local.
function calcVWMA(values: number[], volumes: number[], length: number): number[] {
    if (length <= 0 || values.length < length) return [];

    const result: number[] = [];

    for (let i = length - 1; i < values.length; i++) {
        let weightedSum = 0;
        let volumeSum = 0;

        for (let j = 0; j < length; j++) {
            const idx = i - length + 1 + j;
            weightedSum += values[idx] * volumes[idx];
            volumeSum += volumes[idx];
        }

        result.push(volumeSum === 0 ? values[i] : weightedSum / volumeSum);
    }

    return result;
}

function calcSmoothing(values: number[], volumes: number[], type: number, length: number): number[] {
    switch (type) {
        case RSISmoothing.SMA:
        case RSISmoothing.SMABB:
            return SMA.calculate({ period: length, values });
        case RSISmoothing.EMA:
            return EMA.calculate({ period: length, values });
        case RSISmoothing.RMA:
            return WEMA.calculate({ period: length, values });
        case RSISmoothing.WMA:
            return WMA.calculate({ period: length, values });
        case RSISmoothing.VWMA:
            return calcVWMA(values, volumes, length);
        case RSISmoothing.None:
        default:
            return [];
    }
}

export function calcRSI(data: CandleData[], config: RSIConfig = defaultRSIConfig): RSIData[] {
    if (data.length === 0) return [];

    const sourceValues = data.map(d => getSourceValue(d, config.source));
    const rsiValues = RSI.calculate({
        period: config.period,
        values: sourceValues,
    });

    const offset = data.length - rsiValues.length;
    const result: RSIData[] = data.map((d, i) => ({
        time: d.time,
        value: rsiValues[i - offset],
    }));

    if (config.smoothingType === RSISmoothing.None) return result;

    const validPoints = result
        .map((d, index) => (
            d.value === undefined
                ? null
                : { index, value: d.value, volume: data[index].volume }
        ))
        .filter((p): p is { index: number; value: number; volume: number; } => p !== null);

    if (validPoints.length === 0) return result;

    const values = validPoints.map(p => p.value);
    const volumes = validPoints.map(p => p.volume);
    const smoothingLength = Math.max(1, config.smoothingLength);

    const maValues = calcSmoothing(values, volumes, config.smoothingType, smoothingLength);
    const maOffset = values.length - maValues.length;

    for (let i = 0; i < maValues.length; i++) {
        const outputIndex = validPoints[i + maOffset].index;
        result[outputIndex].ma = maValues[i];
    }

    if (config.smoothingType === RSISmoothing.SMABB) {
        const bb = BollingerBands.calculate({
            period: smoothingLength,
            values,
            stdDev: config.bbStdDev,
        });
        const bbOffset = values.length - bb.length;

        for (let i = 0; i < bb.length; i++) {
            const outputIndex = validPoints[i + bbOffset].index;
            result[outputIndex].bbUpper = bb[i].upper;
            result[outputIndex].bbLower = bb[i].lower;
        }
    }

    return result;
}

function findRSIPivots(
    data: CandleData[],
    rsiData: RSIData[],
    lookbackLeft: number,
    lookbackRight: number
): RSIPivot[] {
    const pivots: RSIPivot[] = [];

    for (let i = lookbackLeft; i < rsiData.length - lookbackRight; i++) {
        const currRsi = rsiData[i].value;
        if (currRsi === undefined) continue;

        let isLow = true;
        let isHigh = true;

        for (let j = 1; j <= lookbackLeft; j++) {
            const left = rsiData[i - j].value;
            if (left === undefined) {
                isLow = false;
                isHigh = false;
                break;
            }
            if (left < currRsi) isLow = false;
            if (left > currRsi) isHigh = false;
        }

        if (!isLow && !isHigh) continue;

        for (let j = 1; j <= lookbackRight; j++) {
            const right = rsiData[i + j].value;
            if (right === undefined) {
                isLow = false;
                isHigh = false;
                break;
            }
            if (right < currRsi) isLow = false;
            if (right > currRsi) isHigh = false;
        }

        if (isLow) {
            pivots.push({
                index: i,
                date: data[i].time,
                price: data[i].low,
                rsi: currRsi,
                type: 'low',
            });
        }

        if (isHigh) {
            pivots.push({
                index: i,
                date: data[i].time,
                price: data[i].high,
                rsi: currRsi,
                type: 'high',
            });
        }
    }

    return pivots;
}

export function findRSIDivergences(
    data: CandleData[],
    rsiData: RSIData[],
    config: Partial<RSIDivergenceConfig> = {}
): RSIDivergence[] {
    const {
        pivotLookbackRight,
        pivotLookbackLeft,
        rangeMin,
        rangeMax,
        plotBullish,
        plotHiddenBullish,
        plotBearish,
        plotHiddenBearish,
    } = {
        ...defaultDivergenceConfig,
        ...config,
    };

    const inRange = (startIndex: number, endIndex: number): boolean => {
        const bars = endIndex - startIndex;
        return bars >= rangeMin && bars <= rangeMax;
    };

    const pivots = findRSIPivots(data, rsiData, pivotLookbackLeft, pivotLookbackRight);
    const divergences: RSIDivergence[] = [];

    const lows = pivots.filter(p => p.type === 'low');
    const highs = pivots.filter(p => p.type === 'high');

    for (let i = 1; i < lows.length; i++) {
        const prev = lows[i - 1];
        const curr = lows[i];

        if (!inRange(prev.index, curr.index)) continue;

        const regularBull = curr.price < prev.price && curr.rsi > prev.rsi;
        if (plotBullish && regularBull) {
            divergences.push({
                type: 'bullish',
                startIndex: prev.index,
                endIndex: curr.index,
                startDate: prev.date,
                endDate: curr.date,
                startPrice: prev.price,
                endPrice: curr.price,
                startRsi: prev.rsi,
                endRsi: curr.rsi,
            });
        }

        const hiddenBull = curr.price > prev.price && curr.rsi < prev.rsi;
        if (plotHiddenBullish && hiddenBull) {
            divergences.push({
                type: 'hiddenBullish',
                startIndex: prev.index,
                endIndex: curr.index,
                startDate: prev.date,
                endDate: curr.date,
                startPrice: prev.price,
                endPrice: curr.price,
                startRsi: prev.rsi,
                endRsi: curr.rsi,
            });
        }
    }

    for (let i = 1; i < highs.length; i++) {
        const prev = highs[i - 1];
        const curr = highs[i];

        if (!inRange(prev.index, curr.index)) continue;

        const regularBear = curr.price > prev.price && curr.rsi < prev.rsi;
        if (plotBearish && regularBear) {
            divergences.push({
                type: 'bearish',
                startIndex: prev.index,
                endIndex: curr.index,
                startDate: prev.date,
                endDate: curr.date,
                startPrice: prev.price,
                endPrice: curr.price,
                startRsi: prev.rsi,
                endRsi: curr.rsi,
            });
        }

        const hiddenBear = curr.price < prev.price && curr.rsi > prev.rsi;
        if (plotHiddenBearish && hiddenBear) {
            divergences.push({
                type: 'hiddenBearish',
                startIndex: prev.index,
                endIndex: curr.index,
                startDate: prev.date,
                endDate: curr.date,
                startPrice: prev.price,
                endPrice: curr.price,
                startRsi: prev.rsi,
                endRsi: curr.rsi,
            });
        }
    }

    return divergences.sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
}
