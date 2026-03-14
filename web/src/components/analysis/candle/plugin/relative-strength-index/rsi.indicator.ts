/**
 * RSI Indicator — Chart series lifecycle management.
 *
 * Encapsulates all lightweight-charts series creation logic for the RSI
 * sub-chart. RSIChart.tsx delegates to these functions instead of inlining
 * the imperative chart API calls.
 */
import {
    createChart,
    createSeriesMarkers,
    LineSeries,
    type ISeriesApi,
} from 'lightweight-charts';
import type { CandleData } from '../../../context/ChartContext';
import {
    calcRSI,
    findRSIDivergences,
    RSISmoothing,
    type RSIConfig,
    type RSIData,
    type RSIDivergence,
    type RSIDivergenceType,
} from './rsi';

// ============================================================================
// Types
// ============================================================================

type Chart = ReturnType<typeof createChart>;

export type RSISeriesRefs = {
    rsi: ISeriesApi<'Line'>;
    upper: ISeriesApi<'Line'>;
    middle: ISeriesApi<'Line'>;
    lower: ISeriesApi<'Line'>;
    ma?: ISeriesApi<'Line'>;
    bbUpper?: ISeriesApi<'Line'>;
    bbLower?: ISeriesApi<'Line'>;
};

export type RSILegend = {
    time: string;
    rsi?: number;
    ma?: number;
    bbUpper?: number;
    bbLower?: number;
};

export type RSIComputedData = {
    rsiData: RSIData[];
    divergences: RSIDivergence[];
};

// ============================================================================
// Computation
// ============================================================================

export function computeRSIData(data: CandleData[], config: RSIConfig): RSIComputedData {
    const rsiData = data.length === 0 ? [] : calcRSI(data, config);

    const divergences = config.showDivergences ? findRSIDivergences(data, rsiData, {
        pivotLookbackLeft: config.pivotLookbackLeft,
        pivotLookbackRight: config.pivotLookbackRight,
        rangeMin: config.rangeMin,
        rangeMax: config.rangeMax,
        plotBullish: config.plotBullish,
        plotHiddenBullish: config.plotHiddenBullish,
        plotBearish: config.plotBearish,
        plotHiddenBearish: config.plotHiddenBearish,
    }) : [];

    return { rsiData, divergences };
}

// ============================================================================
// Helpers
// ============================================================================

function isBullishType(type: RSIDivergenceType): boolean {
    return type === 'bullish' || type === 'hiddenBullish';
}

function getDivergenceLabel(type: RSIDivergenceType): string {
    switch (type) {
        case 'bullish': return 'Bull';
        case 'hiddenBullish': return 'H Bull';
        case 'bearish': return 'Bear';
        case 'hiddenBearish': return 'H Bear';
    }
}

function getDivergenceColor(type: RSIDivergenceType, config: RSIConfig): string {
    switch (type) {
        case 'bullish': return config.divergenceBullColor;
        case 'hiddenBullish': return config.divergenceHiddenBullColor;
        case 'bearish': return config.divergenceBearColor;
        case 'hiddenBearish': return config.divergenceHiddenBearColor;
    }
}

// ============================================================================
// Chart Creation
// ============================================================================

/**
 * Create the full RSI chart with level lines, RSI line, smoothing,
 * Bollinger Bands, and optional divergence overlays.
 */
export function createRSIChart(
    container: HTMLDivElement,
    candleData: CandleData[],
    rsiData: RSIData[],
    config: RSIConfig,
    divergences: RSIDivergence[],
): { chart: Chart; series: RSISeriesRefs } {
    const chart = createChart(container);
    const levelLineWidth = config.levelLineWidth as 1 | 2 | 3 | 4;

    // Overbought line
    const upperSeries = chart.addSeries(LineSeries, {
        color: config.overboughtColor,
        lineWidth: levelLineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });
    upperSeries.setData(candleData.map(d => ({ time: d.time, value: config.overbought })) as any);

    // Middle line
    const middleSeries = chart.addSeries(LineSeries, {
        color: config.middleColor,
        lineWidth: levelLineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: config.showMiddleLine,
    });
    middleSeries.setData(candleData.map(d => ({ time: d.time, value: config.middle })) as any);

    // Oversold line
    const lowerSeries = chart.addSeries(LineSeries, {
        color: config.oversoldColor,
        lineWidth: levelLineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });
    lowerSeries.setData(candleData.map(d => ({ time: d.time, value: config.oversold })) as any);

    // RSI line
    const rsiSeries = chart.addSeries(LineSeries, {
        color: config.rsiColor,
        lineWidth: config.rsiLineWidth as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
    });
    rsiSeries.setData(rsiData.filter(d => d.value !== undefined).map(d => ({ time: d.time, value: d.value })) as any);

    // Divergences
    if (config.showDivergences && divergences.length > 0) {
        divergences.forEach(div => {
            const startTime = rsiData[div.startIndex]?.time;
            const endTime = rsiData[div.endIndex]?.time;
            if (!startTime || !endTime) return;

            const divLineSeries = chart.addSeries(LineSeries, {
                color: getDivergenceColor(div.type, config),
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            });
            divLineSeries.setData([
                { time: startTime, value: div.startRsi },
                { time: endTime, value: div.endRsi },
            ] as any);
        });

        const markers = divergences
            .map(div => {
                const endTime = rsiData[div.endIndex]?.time;
                if (!endTime) return null;
                const bullish = isBullishType(div.type);
                return {
                    time: endTime,
                    position: bullish ? 'belowBar' as const : 'aboveBar' as const,
                    color: getDivergenceColor(div.type, config),
                    shape: bullish ? 'arrowUp' as const : 'arrowDown' as const,
                    text: getDivergenceLabel(div.type),
                };
            })
            .filter((m): m is NonNullable<typeof m> => m !== null)
            .sort((a, b) => String(a.time).localeCompare(String(b.time)));

        if (markers.length > 0) {
            createSeriesMarkers(rsiSeries, markers as any);
        }
    }

    // Smoothing MA
    let maSeries: ISeriesApi<'Line'> | undefined;
    if (config.smoothingType !== RSISmoothing.None) {
        maSeries = chart.addSeries(LineSeries, {
            color: config.smoothingColor,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        maSeries.setData(rsiData.filter(d => d.ma !== undefined).map(d => ({ time: d.time, value: d.ma })) as any);
    }

    // Bollinger Bands
    let bbUpperSeries: ISeriesApi<'Line'> | undefined;
    let bbLowerSeries: ISeriesApi<'Line'> | undefined;
    if (config.smoothingType === RSISmoothing.SMABB) {
        bbUpperSeries = chart.addSeries(LineSeries, {
            color: config.bbColor,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        bbUpperSeries.setData(rsiData.filter(d => d.bbUpper !== undefined).map(d => ({ time: d.time, value: d.bbUpper })) as any);

        bbLowerSeries = chart.addSeries(LineSeries, {
            color: config.bbColor,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        bbLowerSeries.setData(rsiData.filter(d => d.bbLower !== undefined).map(d => ({ time: d.time, value: d.bbLower })) as any);
    }

    return {
        chart,
        series: {
            rsi: rsiSeries,
            upper: upperSeries,
            middle: middleSeries,
            lower: lowerSeries,
            ma: maSeries,
            bbUpper: bbUpperSeries,
            bbLower: bbLowerSeries,
        },
    };
}

// ============================================================================
// Chart Sync Helpers
// ============================================================================

export function syncTimeScale(
    rsiChart: Chart,
    mainChart: Chart,
    syncingRef: { current: boolean },
): () => void {
    const handleMainRangeChange = (range: any) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        rsiChart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
    };

    const handleAuxRangeChange = (range: any) => {
        if (syncingRef.current || !range) return;
        syncingRef.current = true;
        mainChart.timeScale().setVisibleLogicalRange(range);
        syncingRef.current = false;
    };

    mainChart.timeScale().subscribeVisibleLogicalRangeChange(handleMainRangeChange);
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(handleAuxRangeChange);

    return () => {
        mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleMainRangeChange);
        rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleAuxRangeChange);
    };
}

export function syncCrosshair(
    rsiChart: Chart,
    mainChart: Chart,
    rsiSeries: ISeriesApi<'Line'>,
    candleSeries: ISeriesApi<any>,
): () => void {
    const mainToAux = (param: any) => {
        if (param.time) {
            rsiChart.setCrosshairPosition(0, param.time, rsiSeries);
        } else {
            rsiChart.clearCrosshairPosition();
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
    rsiChart.subscribeCrosshairMove(auxToMain);

    return () => {
        mainChart.unsubscribeCrosshairMove(mainToAux);
        rsiChart.unsubscribeCrosshairMove(auxToMain);
    };
}

export function subscribeLegend(
    chart: Chart,
    series: RSISeriesRefs,
    onLegendUpdate: (legend: RSILegend | null) => void,
): () => void {
    const handleCrosshair = (param: any) => {
        if (param.time) {
            const rsi = param.seriesData.get(series.rsi) as any;
            const ma = series.ma ? (param.seriesData.get(series.ma) as any) : undefined;
            const bbUpper = series.bbUpper ? (param.seriesData.get(series.bbUpper) as any) : undefined;
            const bbLower = series.bbLower ? (param.seriesData.get(series.bbLower) as any) : undefined;

            onLegendUpdate({
                time: param.time,
                rsi: rsi?.value,
                ma: ma?.value,
                bbUpper: bbUpper?.value,
                bbLower: bbLower?.value,
            });
        } else {
            onLegendUpdate(null);
        }
    };

    chart.subscribeCrosshairMove(handleCrosshair);
    return () => chart.unsubscribeCrosshairMove(handleCrosshair);
}
