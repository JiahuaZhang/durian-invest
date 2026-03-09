/**
 * Fibonacci Extension Indicator — Chart series lifecycle management.
 *
 * Encapsulates all lightweight-charts series creation/update/toggle/remove
 * logic for the fibonacci-ext overlay.  ChartContext delegates to these
 * methods instead of inlining the logic.
 */
import {
    BaselineSeries,
    LineSeries,
    LineStyle,
    type createChart,
    type ISeriesApi,
} from 'lightweight-charts';
import type { CandleData } from '../../context/ChartContext';
import {
    buildFibExtRenderData,
    computeFibExtData,
    fibExtExtensionBandOrder,
    fibExtExtensionLevelOrder,
    fibExtRetracementBandOrder,
    fibExtRetracementLevelOrder,
    getFibExtExtensionBgColor,
    getFibExtExtensionLineColor,
    getFibExtRetracementBgColor,
    getFibExtRetracementLineColor,
    type FibExtConfig,
    type FibExtRenderData,
} from './fibonacci-ext';

// ============================================================================
// Types
// ============================================================================

type Chart = ReturnType<typeof createChart>;

export type FibExtSeriesEntry = {
    primary: ISeriesApi<any>;
    extras: ISeriesApi<any>[];
};

// ============================================================================
// Helpers
// ============================================================================

function createExtras(
    chart: Chart,
    render: FibExtRenderData,
    config: FibExtConfig,
    showRetracement: boolean,
    showExtension: boolean,
    showTrendline: boolean,
): ISeriesApi<any>[] {
    const fibLineWidth = Math.min(4, Math.max(1, Math.round(config.lineWidth))) as 1 | 2 | 3 | 4;
    const extras: ISeriesApi<any>[] = [];

    // Retracement zone bands
    for (const bandKey of fibExtRetracementBandOrder) {
        const color = getFibExtRetracementBgColor(config, bandKey);
        for (const band of render.retracementZoneBands[bandKey]) {
            const series = chart.addSeries(BaselineSeries, {
                baseValue: { type: 'price' as const, price: band.bottomPrice },
                topFillColor1: color, topFillColor2: color,
                topLineColor: 'transparent',
                bottomFillColor1: 'transparent', bottomFillColor2: 'transparent',
                bottomLineColor: 'transparent',
                lineWidth: 1, lineVisible: false, crosshairMarkerVisible: false,
                priceLineVisible: false, lastValueVisible: false,
            });
            series.setData(band.data as any);
            series.applyOptions({ visible: showRetracement });
            extras.push(series);
        }
    }

    // Extension zone bands
    for (const bandKey of fibExtExtensionBandOrder) {
        const color = getFibExtExtensionBgColor(config, bandKey);
        for (const band of render.extensionZoneBands[bandKey]) {
            const series = chart.addSeries(BaselineSeries, {
                baseValue: { type: 'price' as const, price: band.bottomPrice },
                topFillColor1: color, topFillColor2: color,
                topLineColor: 'transparent',
                bottomFillColor1: 'transparent', bottomFillColor2: 'transparent',
                bottomLineColor: 'transparent',
                lineWidth: 1, lineVisible: false, crosshairMarkerVisible: false,
                priceLineVisible: false, lastValueVisible: false,
            });
            series.setData(band.data as any);
            series.applyOptions({ visible: showExtension });
            extras.push(series);
        }
    }

    // Retracement level lines (7)
    for (const levelKey of fibExtRetracementLevelOrder) {
        const series = chart.addSeries(LineSeries, {
            color: getFibExtRetracementLineColor(config, levelKey),
            lineWidth: fibLineWidth,
            lineStyle: levelKey === 'level5' ? LineStyle.Dotted : LineStyle.Solid,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        series.setData(render.retracementData[levelKey] as any);
        const levelVisible = showRetracement && (levelKey !== 'level5' || config.showMidline);
        series.applyOptions({ visible: levelVisible });
        extras.push(series);
    }

    // Extension level lines (5)
    for (const levelKey of fibExtExtensionLevelOrder) {
        const series = chart.addSeries(LineSeries, {
            color: getFibExtExtensionLineColor(config, levelKey),
            lineWidth: fibLineWidth,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        series.setData(render.extensionData[levelKey] as any);
        series.applyOptions({ visible: showExtension });
        extras.push(series);
    }

    // Trendline series
    for (const segData of render.trendlineSegments) {
        const series = chart.addSeries(LineSeries, {
            color: config.level0LineColor,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        series.setData(segData as any);
        series.applyOptions({ visible: showTrendline });
        extras.push(series);
    }

    return extras;
}

function visibilityFlags(config: FibExtConfig, visible: boolean) {
    const showRetracement = visible && config.historyMode !== 0 && config.showRetracement;
    const showExtension = visible && config.historyMode !== 0 && config.showExtension;
    const showTrendline = visible && config.historyMode !== 0 && config.showTrendline;
    return { showRetracement, showExtension, showTrendline };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create all chart series for a new fibonacci-ext overlay.
 * Returns the entry that should be stored in overlaySeriesRef.
 */
function add(
    chart: Chart,
    candleData: CandleData[],
    config: FibExtConfig,
    visible = true,
): { entry: FibExtSeriesEntry; data: any[] } {
    const computed = computeFibExtData(candleData, config);
    const render = buildFibExtRenderData(candleData, computed, config);
    const { showRetracement, showExtension, showTrendline } = visibilityFlags(config, visible);

    // Primary is a dummy invisible series (no supertrend for this plugin)
    const dummySeries = chart.addSeries(LineSeries, {
        lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    dummySeries.applyOptions({ visible: false });

    const extras = createExtras(chart, render, config, showRetracement, showExtension, showTrendline);

    return {
        entry: { primary: dummySeries, extras },
        data: computed.zigzagPivots,
    };
}

/**
 * Recompute and recreate all extras for an existing fibonacci-ext overlay
 * (e.g., after config change).  Removes old extras, adds new ones.
 */
function update(
    chart: Chart,
    entry: FibExtSeriesEntry,
    candleData: CandleData[],
    config: FibExtConfig,
    visible: boolean,
): any[] {
    const computed = computeFibExtData(candleData, config);
    const render = buildFibExtRenderData(candleData, computed, config);
    const { showRetracement, showExtension, showTrendline } = visibilityFlags(config, visible);

    // Remove old extras
    for (const s of entry.extras) {
        try { chart.removeSeries(s); } catch { /* already removed */ }
    }

    // Recreate
    entry.extras = createExtras(chart, render, config, showRetracement, showExtension, showTrendline);

    return computed.zigzagPivots;
}

/**
 * Toggle visibility of all series in the fibonacci-ext overlay
 * without recomputing data.
 */
function toggle(
    entry: FibExtSeriesEntry,
    config: FibExtConfig,
    visible: boolean,
): void {
    const { showRetracement, showExtension, showTrendline } = visibilityFlags(config, visible);

    // Primary is always invisible
    entry.primary.applyOptions({ visible: false });

    // Find where zone series end (BaselineSeries) and line series begin
    let zoneEnd = 0;
    while (zoneEnd < entry.extras.length) {
        try {
            const opts = (entry.extras[zoneEnd] as any).options();
            if (opts.lineStyle !== undefined) break;
        } catch { break; }
        zoneEnd++;
    }

    // Toggle zone series
    for (let i = 0; i < zoneEnd; i++) {
        entry.extras[i]?.applyOptions({ visible: showRetracement || showExtension });
    }

    // Toggle retracement level lines (7)
    fibExtRetracementLevelOrder.forEach((levelKey, index) => {
        const levelVisible = showRetracement && (levelKey !== 'level5' || config.showMidline);
        entry.extras[zoneEnd + index]?.applyOptions({ visible: levelVisible });
    });

    // Toggle extension level lines (5)
    const extStart = zoneEnd + fibExtRetracementLevelOrder.length;
    fibExtExtensionLevelOrder.forEach((_, index) => {
        entry.extras[extStart + index]?.applyOptions({ visible: showExtension });
    });

    // Toggle trendline series (all remaining)
    const trendStart = extStart + fibExtExtensionLevelOrder.length;
    for (let i = trendStart; i < entry.extras.length; i++) {
        entry.extras[i]?.applyOptions({ visible: showTrendline });
    }
}

/**
 * Remove all series from the chart for this overlay.
 */
function remove(chart: Chart, entry: FibExtSeriesEntry): void {
    const allSeries = [entry.primary, ...entry.extras];
    for (const series of allSeries) {
        try { chart.removeSeries(series); } catch { /* already removed */ }
    }
}

export const fibExtIndicator = { add, update, toggle, remove };
