/**
 * MACD Indicator — Chart series lifecycle management.
 *
 * Encapsulates all lightweight-charts series creation logic for the MACD
 * sub-chart. MACDChart.tsx delegates to these functions instead of inlining
 * the imperative chart API calls.
 */
import {
    createChart,
    createSeriesMarkers,
    HistogramSeries,
    LineSeries,
    type ISeriesApi,
} from 'lightweight-charts';
import type { CandleData } from '../../../context/ChartContext';
import {
    calcMACD,
    findMACDCrosses,
    findMACDDivergences,
    type MACDConfig,
    type MACDData,
    type MACDDivergence,
} from './macd';

// ============================================================================
// Types
// ============================================================================

type Chart = ReturnType<typeof createChart>;

export type MACDSeriesRefs = {
    histogram: ISeriesApi<'Histogram'>;
    macd: ISeriesApi<'Line'>;
    signal: ISeriesApi<'Line'>;
};

export type MACDComputedData = {
    macdData: MACDData[];
    crosses: ReturnType<typeof findMACDCrosses>;
    divergences: MACDDivergence[];
};

// ============================================================================
// Computation
// ============================================================================

/**
 * Compute all MACD-derived data from candle data and config.
 * Pure function — no side effects.
 */
export function computeMACDData(data: CandleData[], config: MACDConfig): MACDComputedData {
    const macdData = calcMACD(data, {
        fast: config.fastPeriod,
        slow: config.slowPeriod,
        signal: config.signalPeriod,
    });

    const crosses = findMACDCrosses(macdData);

    const divergences = (() => {
        if (!config.showDivergences || data.length === 0) return [];
        return findMACDDivergences(data, macdData, {
            pivotLookbackLeft: config.pivotLookbackLeft,
            pivotLookbackRight: config.pivotLookbackRight,
            rangeMin: config.rangeMin,
            rangeMax: config.rangeMax,
            dontTouchZero: config.dontTouchZero,
        });
    })();

    return { macdData, crosses, divergences };
}

// ============================================================================
// Chart Creation
// ============================================================================

/**
 * Build the 4-color histogram data from MACD values.
 */
function buildHistogramData(macdData: MACDData[]) {
    return macdData
        .filter(d => d.histogram !== undefined)
        .map((d, i, arr) => {
            const hist = d.histogram ?? 0;
            const prevHist = i > 0 ? (arr[i - 1].histogram ?? 0) : 0;
            const isGrowing = hist > prevHist;

            let color: string;
            if (hist >= 0) {
                color = isGrowing ? '#26A69A' : '#B2DFDB';
            } else {
                color = isGrowing ? '#FFCDD2' : '#FF5252';
            }

            return { time: d.time, value: hist, color };
        });
}

/**
 * Add divergence lines and markers to the chart.
 */
function addDivergences(
    chart: Chart,
    macdLineSeries: ISeriesApi<'Line'>,
    macdData: MACDData[],
    divergences: MACDDivergence[],
    config: MACDConfig,
) {
    divergences.forEach(div => {
        const color = div.type === 'bullish' ? config.divergenceBullColor : config.divergenceBearColor;
        const startTime = macdData[div.startIndex]?.time;
        const endTime = macdData[div.endIndex]?.time;

        if (startTime && endTime) {
            const lineSeries = chart.addSeries(LineSeries, {
                color,
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            });
            lineSeries.setData([
                { time: startTime, value: div.startMacd },
                { time: endTime, value: div.endMacd },
            ] as any);
        }
    });

    const markers = divergences
        .map(div => {
            const endTime = macdData[div.endIndex]?.time;
            if (!endTime) return null;
            return {
                time: endTime,
                position: div.type === 'bullish' ? 'belowBar' as const : 'aboveBar' as const,
                color: div.type === 'bullish' ? config.divergenceBullColor : config.divergenceBearColor,
                shape: div.type === 'bullish' ? 'arrowUp' as const : 'arrowDown' as const,
                text: div.type === 'bullish' ? 'Bull' : 'Bear',
            };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => String(a.time).localeCompare(String(b.time)));

    if (markers.length > 0) {
        createSeriesMarkers(macdLineSeries, markers as any);
    }
}

/**
 * Create the full MACD chart with histogram, MACD line, signal line,
 * and optional divergence overlays.
 *
 * Returns the chart instance and series references.
 */
export function createMACDChart(
    container: HTMLDivElement,
    macdData: MACDData[],
    config: MACDConfig,
    divergences: MACDDivergence[],
): { chart: Chart; series: MACDSeriesRefs } {
    const chart = createChart(container);

    // 4-color histogram
    const histogramSeries = chart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
    });
    histogramSeries.setData(buildHistogramData(macdData) as any);

    // MACD line
    const macdLineSeries = chart.addSeries(LineSeries, {
        color: config.macdColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
    });
    macdLineSeries.setData(macdData.map(d => ({ time: d.time, value: d.macd })) as any);

    // Signal line
    const signalLineSeries = chart.addSeries(LineSeries, {
        color: config.signalColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
    });
    signalLineSeries.setData(macdData.map(d => ({ time: d.time, value: d.signal })) as any);

    // Divergence overlays
    if (config.showDivergences && divergences.length > 0) {
        addDivergences(chart, macdLineSeries, macdData, divergences, config);
    }

    return {
        chart,
        series: { histogram: histogramSeries, macd: macdLineSeries, signal: signalLineSeries },
    };
}

// ============================================================================
// Chart Sync Helpers
// ============================================================================

/**
 * Subscribe time-scale syncing between the MACD chart and the main chart.
 * Returns a cleanup function to unsubscribe.
 */
export function syncTimeScale(
    macdChart: Chart,
    mainChart: Chart,
    syncingRef: { current: boolean },
): () => void {
    const handleMainRangeChange = (range: any) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        macdChart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
    };

    const handleAuxRangeChange = (range: any) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        mainChart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
    };

    mainChart.timeScale().subscribeVisibleLogicalRangeChange(handleMainRangeChange);
    macdChart.timeScale().subscribeVisibleLogicalRangeChange(handleAuxRangeChange);

    return () => {
        mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleMainRangeChange);
        macdChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleAuxRangeChange);
    };
}

/**
 * Subscribe crosshair syncing between the MACD chart and the main chart.
 * Returns a cleanup function to unsubscribe.
 */
export function syncCrosshair(
    macdChart: Chart,
    mainChart: Chart,
    histogramSeries: ISeriesApi<'Histogram'>,
    candleSeries: ISeriesApi<any>,
): () => void {
    const mainToAux = (param: any) => {
        if (param.time) {
            macdChart.setCrosshairPosition(0, param.time, histogramSeries);
        } else {
            macdChart.clearCrosshairPosition();
        }
    };

    const auxToMain = (param: any) => {
        if (param.time) {
            mainChart.setCrosshairPosition(0, param.time, candleSeries);
        } else {
            mainChart.clearCrosshairPosition();
        }
    };

    mainChart.subscribeCrosshairMove(mainToAux);
    macdChart.subscribeCrosshairMove(auxToMain);

    return () => {
        mainChart.unsubscribeCrosshairMove(mainToAux);
        macdChart.unsubscribeCrosshairMove(auxToMain);
    };
}

/**
 * Subscribe crosshair move to update legend data.
 * Returns a cleanup function to unsubscribe.
 */
export function subscribeLegend(
    chart: Chart,
    series: MACDSeriesRefs,
    onLegendUpdate: (legend: MACDData | null) => void,
): () => void {
    const handleCrosshair = (param: any) => {
        if (param.time) {
            const h = param.seriesData.get(series.histogram) as any;
            const m = param.seriesData.get(series.macd) as any;
            const s = param.seriesData.get(series.signal) as any;
            onLegendUpdate({
                time: param.time,
                histogram: h?.value,
                macd: m?.value,
                signal: s?.value,
            });
        } else {
            onLegendUpdate(null);
        }
    };

    chart.subscribeCrosshairMove(handleCrosshair);
    return () => chart.unsubscribeCrosshairMove(handleCrosshair);
}
