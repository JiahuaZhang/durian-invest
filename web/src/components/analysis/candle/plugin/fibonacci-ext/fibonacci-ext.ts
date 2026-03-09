import type { LineData, Time, WhitespaceData } from 'lightweight-charts';
import { ATR } from 'technicalindicators';
import type { CandleData } from '../../../context/ChartContext';
import type { MetaField } from '../meta';
import { getDefaultConfig, type DeriveConfig } from '../meta';

// ============================================================================
// Level Order Constants
// ============================================================================

export const fibExtRetracementLevelOrder = [
    'level0',
    'level236',
    'level382',
    'level5',
    'level618',
    'level786',
    'level1',
] as const;

export const fibExtExtensionLevelOrder = [
    'ext1272',
    'ext1414',
    'ext1618',
    'ext2',
    'ext2618',
] as const;

export const fibExtRetracementBandOrder = [
    'zone0_236',
    'zone236_382',
    'zone382_5',
    'zone5_618',
    'zone618_786',
    'zone786_1',
] as const;

export const fibExtExtensionBandOrder = [
    'zone1272_1414',
    'zone1414_1618',
    'zone1618_2',
    'zone2_2618',
] as const;

export type FibExtRetracementLevelKey = typeof fibExtRetracementLevelOrder[number];
export type FibExtExtensionLevelKey = typeof fibExtExtensionLevelOrder[number];
export type FibExtRetracementBandKey = typeof fibExtRetracementBandOrder[number];
export type FibExtExtensionBandKey = typeof fibExtExtensionBandOrder[number];

const RETRACEMENT_RATIOS: Record<FibExtRetracementLevelKey, number> = {
    level0: 0,
    level236: 0.236,
    level382: 0.382,
    level5: 0.5,
    level618: 0.618,
    level786: 0.786,
    level1: 1,
};

const EXTENSION_RATIOS: Record<FibExtExtensionLevelKey, number> = {
    ext1272: 1.272,
    ext1414: 1.414,
    ext1618: 1.618,
    ext2: 2,
    ext2618: 2.618,
};

// ============================================================================
// Meta / Config
// ============================================================================

export const FibExtMeta = [
    { key: 'deviation', label: 'Deviation (ATR ×)', group: 'Input', type: 'number', default: 3, min: 0.1, max: 20, step: 0.1 },
    { key: 'depth', label: 'Depth (Bars)', group: 'Input', type: 'number', default: 11, min: 1, max: 100, step: 1 },
    {
        key: 'historyMode',
        label: 'Historical Ranges',
        group: 'Input',
        type: 'select',
        default: 1,
        options: [
            { value: 0, label: 'None' },
            { value: 1, label: 'Last Only' },
            { value: 2, label: 'All' },
        ] as const,
    },
    { key: 'showRetracement', label: 'Show Retracement (0–1)', group: 'Input', type: 'boolean', default: true },
    { key: 'showExtension', label: 'Show Extension (1.272+)', group: 'Input', type: 'boolean', default: true },
    { key: 'showTrendline', label: 'Show Zigzag Trendline', group: 'Input', type: 'boolean', default: true },
    { key: 'showMidline', label: 'Show 0.5 Midline', group: 'Input', type: 'boolean', default: true },
    {
        key: 'lineWidth',
        label: 'Line Width',
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
    // Retracement colors
    { key: 'level0LineColor', label: '0 Line', group: 'Style - Retracement', type: 'color', default: '#787b86' },
    { key: 'level236LineColor', label: '0.236 Line', group: 'Style - Retracement', type: 'color', default: '#f23645' },
    { key: 'level382LineColor', label: '0.382 Line', group: 'Style - Retracement', type: 'color', default: '#ff9800' },
    { key: 'level5LineColor', label: '0.5 Line', group: 'Style - Retracement', type: 'color', default: '#4caf50' },
    { key: 'level618LineColor', label: '0.618 Line', group: 'Style - Retracement', type: 'color', default: '#26a69a' },
    { key: 'level786LineColor', label: '0.786 Line', group: 'Style - Retracement', type: 'color', default: '#2196f3' },
    { key: 'level1LineColor', label: '1 Line', group: 'Style - Retracement', type: 'color', default: '#787b86' },
    { key: 'level0BgColor', label: '0 Background', group: 'Style - Retracement', type: 'color', default: '#f2364522' },
    { key: 'level236BgColor', label: '0.236 Background', group: 'Style - Retracement', type: 'color', default: '#ff572222' },
    { key: 'level382BgColor', label: '0.382 Background', group: 'Style - Retracement', type: 'color', default: '#ff980022' },
    { key: 'level5BgColor', label: '0.5 Background', group: 'Style - Retracement', type: 'color', default: '#4caf5022' },
    { key: 'level618BgColor', label: '0.618 Background', group: 'Style - Retracement', type: 'color', default: '#26a69a22' },
    { key: 'level786BgColor', label: '0.786 Background', group: 'Style - Retracement', type: 'color', default: '#2196f322' },
    { key: 'level1BgColor', label: '1 Background', group: 'Style - Retracement', type: 'color', default: '#9e9e9e22' },
    // Extension colors
    { key: 'ext1272LineColor', label: '1.272 Line', group: 'Style - Extension', type: 'color', default: '#8e24aa' },
    { key: 'ext1414LineColor', label: '1.414 Line', group: 'Style - Extension', type: 'color', default: '#7b1fa2' },
    { key: 'ext1618LineColor', label: '1.618 Line', group: 'Style - Extension', type: 'color', default: '#6a1b9a' },
    { key: 'ext2LineColor', label: '2.0 Line', group: 'Style - Extension', type: 'color', default: '#5e35b1' },
    { key: 'ext2618LineColor', label: '2.618 Line', group: 'Style - Extension', type: 'color', default: '#512da8' },
    { key: 'ext1272BgColor', label: '1.272 Background', group: 'Style - Extension', type: 'color', default: '#8e24aa22' },
    { key: 'ext1414BgColor', label: '1.414 Background', group: 'Style - Extension', type: 'color', default: '#7b1fa222' },
    { key: 'ext1618BgColor', label: '1.618 Background', group: 'Style - Extension', type: 'color', default: '#6a1b9a22' },
    { key: 'ext2BgColor', label: '2.0 Background', group: 'Style - Extension', type: 'color', default: '#5e35b122' },
    { key: 'ext2618BgColor', label: '2.618 Background', group: 'Style - Extension', type: 'color', default: '#512da822' },
] as const satisfies readonly MetaField[];

export type FibExtConfig = DeriveConfig<typeof FibExtMeta>;
export const defaultFibExtConfig: FibExtConfig = getDefaultConfig(FibExtMeta);

export type FibExtHistoryMode = 0 | 1 | 2;

export function getFibExtHistoryModeLabel(mode: number): string {
    if (mode === 0) return 'None';
    if (mode === 2) return 'All';
    return 'Last';
}

function normalizeHistoryMode(mode: number): FibExtHistoryMode {
    if (mode === 0 || mode === 2) return mode;
    return 1;
}

// ============================================================================
// Color Accessors
// ============================================================================

const retracementLineColorKey: Record<FibExtRetracementLevelKey, keyof FibExtConfig> = {
    level0: 'level0LineColor',
    level236: 'level236LineColor',
    level382: 'level382LineColor',
    level5: 'level5LineColor',
    level618: 'level618LineColor',
    level786: 'level786LineColor',
    level1: 'level1LineColor',
};

const retracementBgColorKey: Record<FibExtRetracementBandKey, keyof FibExtConfig> = {
    zone0_236: 'level236BgColor',
    zone236_382: 'level382BgColor',
    zone382_5: 'level5BgColor',
    zone5_618: 'level618BgColor',
    zone618_786: 'level786BgColor',
    zone786_1: 'level1BgColor',
};

const extensionLineColorKey: Record<FibExtExtensionLevelKey, keyof FibExtConfig> = {
    ext1272: 'ext1272LineColor',
    ext1414: 'ext1414LineColor',
    ext1618: 'ext1618LineColor',
    ext2: 'ext2LineColor',
    ext2618: 'ext2618LineColor',
};

const extensionBgColorKey: Record<FibExtExtensionBandKey, keyof FibExtConfig> = {
    zone1272_1414: 'ext1414BgColor',
    zone1414_1618: 'ext1618BgColor',
    zone1618_2: 'ext2BgColor',
    zone2_2618: 'ext2618BgColor',
};

export function getFibExtRetracementLineColor(config: FibExtConfig, key: FibExtRetracementLevelKey): string {
    return config[retracementLineColorKey[key]] as string;
}
export function getFibExtRetracementBgColor(config: FibExtConfig, key: FibExtRetracementBandKey): string {
    return config[retracementBgColorKey[key]] as string;
}
export function getFibExtExtensionLineColor(config: FibExtConfig, key: FibExtExtensionLevelKey): string {
    return config[extensionLineColorKey[key]] as string;
}
export function getFibExtExtensionBgColor(config: FibExtConfig, key: FibExtExtensionBandKey): string {
    return config[extensionBgColorKey[key]] as string;
}

// ============================================================================
// Types
// ============================================================================

/** A confirmed zigzag pivot point. */
export type ZigzagPivot = {
    index: number;   // bar index within candleData
    price: number;
    isHigh: boolean;
};

/** The 3-point structure for extension: A (start) → B (mid) → C (end). */
export type FibExtABC = {
    a: ZigzagPivot;
    b: ZigzagPivot;
    c: ZigzagPivot;
};

export type FibExtComputation = {
    zigzagPivots: ZigzagPivot[];
    abcList: FibExtABC[];
};

type RenderPoint = LineData<Time> | WhitespaceData<Time>;

export type FibExtZoneBand = {
    topPrice: number;
    bottomPrice: number;
    data: Array<LineData<Time> | WhitespaceData<Time>>;
};

export type FibExtRenderData = {
    retracementData: Record<FibExtRetracementLevelKey, RenderPoint[]>;
    extensionData: Record<FibExtExtensionLevelKey, RenderPoint[]>;
    retracementZoneBands: Record<FibExtRetracementBandKey, FibExtZoneBand[]>;
    extensionZoneBands: Record<FibExtExtensionBandKey, FibExtZoneBand[]>;
    trendlineSegments: LineData<Time>[][];
};

// ============================================================================
// Pivot / Zigzag Detection (ported from TradingView DGT script)
// ============================================================================

/**
 * Find pivot highs and lows.
 * A pivot high at bar i requires that high[i] >= all highs in [i-halfLen, i+halfLen].
 * A pivot low  at bar i requires that low[i]  <= all lows  in [i-halfLen, i+halfLen].
 * The pivot is confirmed `halfLen` bars later (lookahead).
 */
function findPivots(
    candleData: CandleData[],
    depth: number,
): { pivotHighs: Array<{ index: number; price: number }>; pivotLows: Array<{ index: number; price: number }> } {
    const halfLen = Math.max(1, Math.floor(depth / 2));
    const pivotHighs: Array<{ index: number; price: number }> = [];
    const pivotLows: Array<{ index: number; price: number }> = [];

    for (let i = halfLen; i < candleData.length - halfLen; i++) {
        // Check pivot high
        let isHigh = true;
        const hVal = candleData[i].high;
        for (let j = i - halfLen; j <= i + halfLen; j++) {
            if (candleData[j].high > hVal) { isHigh = false; break; }
        }
        if (isHigh) pivotHighs.push({ index: i, price: hVal });

        // Check pivot low
        let isLow = true;
        const lVal = candleData[i].low;
        for (let j = i - halfLen; j <= i + halfLen; j++) {
            if (candleData[j].low < lVal) { isLow = false; break; }
        }
        if (isLow) pivotLows.push({ index: i, price: lVal });
    }

    return { pivotHighs, pivotLows };
}

/**
 * Compute ATR values for deviation threshold.
 * Uses ATR(10) as in the TradingView script.
 */
function computeAtr10(candleData: CandleData[]): number[] {
    if (candleData.length === 0) return [];
    if (candleData.length === 1) return [Math.max(candleData[0].high - candleData[0].low, 0)];

    const period = Math.min(10, candleData.length - 1);
    const atrValues = ATR.calculate({
        high: candleData.map(c => c.high),
        low: candleData.map(c => c.low),
        close: candleData.map(c => c.close),
        period,
    });

    if (atrValues.length === 0) {
        const range = Math.max(candleData[0].high - candleData[0].low, 0);
        return new Array(candleData.length).fill(range);
    }

    const offset = candleData.length - atrValues.length;
    const seed = atrValues[0];
    return candleData.map((_, idx) => (idx < offset ? seed : atrValues[idx - offset]));
}

/**
 * Build zigzag from pivot points, filtering by ATR-based deviation threshold.
 * Mirrors the TradingView script's pivotFound logic:
 *   - If the new pivot is same direction as last, update it if it's a more extreme value
 *   - If different direction, only accept if deviation > threshold (ATR * factor / close * 100)
 */
function buildZigzag(
    candleData: CandleData[],
    depth: number,
    deviationFactor: number,
): ZigzagPivot[] {
    const { pivotHighs, pivotLows } = findPivots(candleData, depth);
    const atr = computeAtr10(candleData);

    // Merge and sort all pivots by bar index
    type RawPivot = { index: number; price: number; isHigh: boolean };
    const allPivots: RawPivot[] = [
        ...pivotHighs.map(p => ({ ...p, isHigh: true })),
        ...pivotLows.map(p => ({ ...p, isHigh: false })),
    ].sort((a, b) => a.index - b.index);

    if (allPivots.length === 0) return [];

    const zigzag: ZigzagPivot[] = [];
    zigzag.push({ index: allPivots[0].index, price: allPivots[0].price, isHigh: allPivots[0].isHigh });

    for (let i = 1; i < allPivots.length; i++) {
        const p = allPivots[i];
        const last = zigzag[zigzag.length - 1];

        if (p.isHigh === last.isHigh) {
            // Same direction: update if more extreme
            if (p.isHigh && p.price > last.price) {
                last.index = p.index;
                last.price = p.price;
            } else if (!p.isHigh && p.price < last.price) {
                last.index = p.index;
                last.price = p.price;
            }
        } else {
            // Different direction: check deviation threshold
            const close = candleData[p.index].close;
            const devThreshold = (atr[p.index] / close) * 100 * deviationFactor;
            const dev = Math.abs(100 * (p.price - last.price) / p.price);

            if (dev > devThreshold) {
                zigzag.push({ index: p.index, price: p.price, isHigh: p.isHigh });
            }
        }
    }

    return zigzag;
}

// ============================================================================
// Computation
// ============================================================================

/**
 * Main computation: finds the zigzag pivots and extracts all possible
 * 3-point A→B→C structures for extension/retracement.
 *
 * Every consecutive 3-pivot window in the zigzag forms an ABC triplet:
 *   zigzag[i] = A, zigzag[i+1] = B, zigzag[i+2] = C
 *
 * The retracement is drawn over the B→C leg.
 * The extension projects from C using the A→B offset × fib ratios.
 */
export function computeFibExtData(
    candleData: CandleData[],
    config: FibExtConfig = defaultFibExtConfig,
): FibExtComputation {
    if (candleData.length < 3) return { zigzagPivots: [], abcList: [] };

    const depth = Math.max(1, Math.floor(config.depth));
    const deviation = Math.max(0.1, config.deviation);
    const zigzagPivots = buildZigzag(candleData, depth, deviation);

    if (zigzagPivots.length < 3) return { zigzagPivots, abcList: [] };

    // Extract all ABC triplets from consecutive zigzag pivot windows
    const abcList: FibExtABC[] = [];
    for (let i = 0; i <= zigzagPivots.length - 3; i++) {
        abcList.push({
            a: zigzagPivots[i],
            b: zigzagPivots[i + 1],
            c: zigzagPivots[i + 2],
        });
    }

    return { zigzagPivots, abcList };
}

/**
 * Filter ABC triplets based on history mode.
 */
function getVisibleABCs(abcList: FibExtABC[], mode: FibExtHistoryMode): FibExtABC[] {
    if (mode === 0) return [];
    if (mode === 1) return abcList.length > 0 ? [abcList[abcList.length - 1]] : [];
    return abcList;
}

// ============================================================================
// Render Data Builder
// ============================================================================

function createEmptyRetracementData(candleData: CandleData[]): Record<FibExtRetracementLevelKey, RenderPoint[]> {
    const blank = () => candleData.map(c => ({ time: c.time as unknown as Time }));
    return {
        level0: blank(), level236: blank(), level382: blank(),
        level5: blank(), level618: blank(), level786: blank(), level1: blank(),
    };
}

function createEmptyExtensionData(candleData: CandleData[]): Record<FibExtExtensionLevelKey, RenderPoint[]> {
    const blank = () => candleData.map(c => ({ time: c.time as unknown as Time }));
    return {
        ext1272: blank(), ext1414: blank(), ext1618: blank(), ext2: blank(), ext2618: blank(),
    };
}

function buildZoneBand(
    candleData: CandleData[],
    startIndex: number,
    endIndex: number,
    topPrice: number,
    bottomPrice: number,
): FibExtZoneBand {
    const data: Array<LineData<Time> | WhitespaceData<Time>> = candleData.map((candle, i) => {
        if (i >= startIndex && i <= endIndex) {
            return { time: candle.time as unknown as Time, value: topPrice };
        }
        return { time: candle.time as unknown as Time };
    });
    return { topPrice, bottomPrice, data };
}

/**
 * Compute retracement/extension levels and draw range for a single ABC triplet.
 */
function computeABCLevels(abc: FibExtABC) {
    const { a, b, c } = abc;

    // Retracement spans the B→C leg
    const retLevel0 = b.price;
    const retLevel1 = c.price;
    const retRange = retLevel1 - retLevel0; // signed

    const retLevels: Record<FibExtRetracementLevelKey, number> = {
        level0: retLevel0 + retRange * RETRACEMENT_RATIOS.level0,
        level236: retLevel0 + retRange * RETRACEMENT_RATIOS.level236,
        level382: retLevel0 + retRange * RETRACEMENT_RATIOS.level382,
        level5: retLevel0 + retRange * RETRACEMENT_RATIOS.level5,
        level618: retLevel0 + retRange * RETRACEMENT_RATIOS.level618,
        level786: retLevel0 + retRange * RETRACEMENT_RATIOS.level786,
        level1: retLevel0 + retRange * RETRACEMENT_RATIOS.level1,
    };

    // Extension formula from TradingView DGT script
    const isBullishCorrection = c.price > b.price;
    const offsetAB = Math.abs(b.price - a.price);
    const pivotDiffBC = Math.abs(b.price - c.price);

    const computeExtLevel = (ratio: number): number => {
        if (isBullishCorrection) {
            return b.price + pivotDiffBC - offsetAB * ratio;
        } else {
            return b.price - pivotDiffBC + offsetAB * ratio;
        }
    };

    const extLevels: Record<FibExtExtensionLevelKey, number> = {
        ext1272: computeExtLevel(EXTENSION_RATIOS.ext1272),
        ext1414: computeExtLevel(EXTENSION_RATIOS.ext1414),
        ext1618: computeExtLevel(EXTENSION_RATIOS.ext1618),
        ext2: computeExtLevel(EXTENSION_RATIOS.ext2),
        ext2618: computeExtLevel(EXTENSION_RATIOS.ext2618),
    };

    return { retLevels, extLevels };
}

const RETRACEMENT_BAND_PAIRS: Array<[FibExtRetracementBandKey, FibExtRetracementLevelKey, FibExtRetracementLevelKey]> = [
    ['zone0_236', 'level0', 'level236'],
    ['zone236_382', 'level236', 'level382'],
    ['zone382_5', 'level382', 'level5'],
    ['zone5_618', 'level5', 'level618'],
    ['zone618_786', 'level618', 'level786'],
    ['zone786_1', 'level786', 'level1'],
];

const EXTENSION_BAND_PAIRS: Array<[FibExtExtensionBandKey, FibExtExtensionLevelKey, FibExtExtensionLevelKey]> = [
    ['zone1272_1414', 'ext1272', 'ext1414'],
    ['zone1414_1618', 'ext1414', 'ext1618'],
    ['zone1618_2', 'ext1618', 'ext2'],
    ['zone2_2618', 'ext2', 'ext2618'],
];

/**
 * Build all render data (lines, zone bands, trendlines) from the computation.
 * Respects historyMode to show none, last, or all ABC triplets.
 */
export function buildFibExtRenderData(
    candleData: CandleData[],
    computed: FibExtComputation,
    config: FibExtConfig = defaultFibExtConfig,
): FibExtRenderData {
    const retracementData = createEmptyRetracementData(candleData);
    const extensionData = createEmptyExtensionData(candleData);
    const retracementZoneBands: Record<FibExtRetracementBandKey, FibExtZoneBand[]> = {
        zone0_236: [], zone236_382: [], zone382_5: [],
        zone5_618: [], zone618_786: [], zone786_1: [],
    };
    const extensionZoneBands: Record<FibExtExtensionBandKey, FibExtZoneBand[]> = {
        zone1272_1414: [], zone1414_1618: [],
        zone1618_2: [], zone2_2618: [],
    };
    const trendlineSegments: LineData<Time>[][] = [];

    const historyMode = normalizeHistoryMode(config.historyMode);
    const visibleABCs = getVisibleABCs(computed.abcList, historyMode);

    if (visibleABCs.length === 0) {
        return { retracementData, extensionData, retracementZoneBands, extensionZoneBands, trendlineSegments };
    }

    for (const abc of visibleABCs) {
        const { a, b, c } = abc;
        const { retLevels, extLevels } = computeABCLevels(abc);

        // Draw range: from B's index to C's index (for historical), or to end of chart (for the last ABC)
        const isLast = abc === visibleABCs[visibleABCs.length - 1];
        const drawStart = b.index;
        const drawEnd = isLast ? candleData.length - 1 : c.index;

        // Retracement lines + zones
        if (config.showRetracement) {
            for (const key of fibExtRetracementLevelOrder) {
                if (key === 'level5' && !config.showMidline) continue;
                const value = retLevels[key];
                for (let i = drawStart; i <= drawEnd; i++) {
                    retracementData[key][i] = { time: candleData[i].time as unknown as Time, value };
                }
            }
            for (const [bandKey, lowKey, highKey] of RETRACEMENT_BAND_PAIRS) {
                const top = Math.max(retLevels[lowKey], retLevels[highKey]);
                const bottom = Math.min(retLevels[lowKey], retLevels[highKey]);
                retracementZoneBands[bandKey].push(buildZoneBand(candleData, drawStart, drawEnd, top, bottom));
            }
        }

        // Extension lines + zones
        if (config.showExtension) {
            for (const key of fibExtExtensionLevelOrder) {
                const value = extLevels[key];
                for (let i = drawStart; i <= drawEnd; i++) {
                    extensionData[key][i] = { time: candleData[i].time as unknown as Time, value };
                }
            }
            for (const [bandKey, lowKey, highKey] of EXTENSION_BAND_PAIRS) {
                const top = Math.max(extLevels[lowKey], extLevels[highKey]);
                const bottom = Math.min(extLevels[lowKey], extLevels[highKey]);
                extensionZoneBands[bandKey].push(buildZoneBand(candleData, drawStart, drawEnd, top, bottom));
            }
        }

        // Trendlines: A→B and B→C legs
        if (config.showTrendline) {
            if (a.index !== b.index) {
                const legAB: LineData<Time>[] = [];
                const span = b.index - a.index;
                for (let i = a.index; i <= b.index; i++) {
                    const t = span === 0 ? 0 : (i - a.index) / span;
                    legAB.push({ time: candleData[i].time as unknown as Time, value: a.price + (b.price - a.price) * t });
                }
                trendlineSegments.push(legAB);
            }
            if (b.index !== c.index) {
                const legBC: LineData<Time>[] = [];
                const span = c.index - b.index;
                for (let i = b.index; i <= c.index; i++) {
                    const t = span === 0 ? 0 : (i - b.index) / span;
                    legBC.push({ time: candleData[i].time as unknown as Time, value: b.price + (c.price - b.price) * t });
                }
                trendlineSegments.push(legBC);
            }
        }
    }

    return { retracementData, extensionData, retracementZoneBands, extensionZoneBands, trendlineSegments };
}
