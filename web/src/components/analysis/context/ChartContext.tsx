import { BaselineSeries, CandlestickSeries, createChart, ISeriesApi, LineSeries, LineStyle } from 'lightweight-charts';
import { createContext, useCallback, useContext, useMemo, useReducer, useRef, type ReactNode } from 'react';
import {
    buildFibonacciRenderData,
    computeFibonacciData,
    defaultFibonacciConfig,
    fibonacciExtensionBandOrder,
    fibonacciExtensionLevelOrder,
    fibonacciRetracementBandOrder,
    fibonacciRetracementLevelOrder,
    getExtensionBgColor,
    getExtensionLineColor,
    getRetracementBgColor,
    getRetracementLineColor,
    type FibonacciConfig,
    type FibonacciRenderData,
} from '../plugin/fibonacci/fibonacci';
import { defaultMACDConfig, type MACDConfig } from '../plugin/macd/macd';
import { computeMarketBiasData, defaultMarketBiasConfig, type MarketBiasConfig } from '../plugin/market-bias/market-bias';
import { computeMAData, createMASeries, getDefaultMAConfig, type MAConfig } from '../plugin/moving-average/ma';
import { defaultRSIConfig, type RSIConfig } from '../plugin/relative-strength-index/rsi';
import { computeVolumeData, createVolumeSeries, defaultVolumeConfig, type VolumeConfig } from '../plugin/volume/volume';
import { useCandleData } from './ChartDataContext';

// Re-export CandleData types
export { useCandleData, type CandleData } from './ChartDataContext';

// ============================================================================
// Types
// ============================================================================

export type OverlayType = 'volume' | 'sma' | 'ema' | 'market-bias' | 'fibonacci';
export type IndicatorType = 'macd' | 'rsi';

// Re-export plugin config types for convenience
export type { FibonacciConfig } from '../plugin/fibonacci/fibonacci';
export type { MACDConfig } from '../plugin/macd/macd';
export type { MarketBiasConfig } from '../plugin/market-bias/market-bias';
export type { RSIConfig } from '../plugin/relative-strength-index/rsi';
export type { VolumeConfig } from '../plugin/volume/volume';

export type OverlayIndicator = {
    id: string;
    type: OverlayType;
    visible: boolean;
    config: VolumeConfig | MAConfig | MarketBiasConfig | FibonacciConfig;
    data: any[];
};

export type SubIndicator = {
    id: string;
    type: IndicatorType;
    visible: boolean;
    config: MACDConfig | RSIConfig;
    data?: any;
    chart?: ReturnType<typeof createChart>;
    series?: Record<string, ISeriesApi<any>>;
};

// Legend types
export type MainLegend = {
    open: number;
    high: number;
    low: number;
    close: number;
};

export type VolumeLegend = { volume: number; };
export type SMALegend = { value: number; };
export type EMALegend = { value: number; };
export type MarketBiasLegend = { open: number; high: number; low: number; close: number; };
export type FibonacciLegend = { value: number; };
export type OverlayLegend = VolumeLegend | SMALegend | EMALegend | MarketBiasLegend | FibonacciLegend;

type OverlaySeriesEntry = {
    primary: ISeriesApi<any>;
    extras: ISeriesApi<any>[];
};

// ============================================================================
// State
// ============================================================================

type ChartState = {
    overlays: Record<string, OverlayIndicator>;
    indicators: Record<string, SubIndicator>;
    mainLegend: MainLegend | null;
    overlayLegends: Record<string, OverlayLegend | undefined>;
};

const initialState: ChartState = {
    overlays: {
        'volume-default': {
            id: 'volume-default',
            type: 'volume',
            visible: true,
            config: { ...defaultVolumeConfig },
            data: [],
        },
    },
    indicators: {},
    mainLegend: null,
    overlayLegends: {},
};

// ============================================================================
// Actions
// ============================================================================

type ChartAction =
    | { type: 'OVERLAY_ADDED'; overlay: OverlayIndicator; }
    | { type: 'OVERLAY_REMOVED'; id: string; }
    | { type: 'OVERLAY_CONFIG_UPDATED'; id: string; config: VolumeConfig | MAConfig | MarketBiasConfig | FibonacciConfig; data: any[]; }
    | { type: 'OVERLAY_TOGGLED'; id: string; visible: boolean; }
    | { type: 'INDICATOR_ADDED'; indicator: SubIndicator; }
    | { type: 'INDICATOR_REMOVED'; id: string; }
    | { type: 'INDICATOR_UPDATED'; id: string; updates: Partial<SubIndicator>; }
    | { type: 'INDICATOR_CONFIG_UPDATED'; id: string; config: MACDConfig | RSIConfig; }
    | { type: 'INDICATOR_TOGGLED'; id: string; }
    | { type: 'MAIN_LEGEND_SET'; legend: MainLegend | null; }
    | { type: 'OVERLAY_LEGEND_SET'; id: string; legend: OverlayLegend | undefined; };

function chartReducer(state: ChartState, action: ChartAction): ChartState {
    switch (action.type) {
        case 'OVERLAY_ADDED':
            return { ...state, overlays: { ...state.overlays, [action.overlay.id]: action.overlay } };

        case 'OVERLAY_REMOVED': {
            const { [action.id]: _, ...rest } = state.overlays;
            const { [action.id]: __, ...legendRest } = state.overlayLegends;
            return { ...state, overlays: rest, overlayLegends: legendRest };
        }

        case 'OVERLAY_CONFIG_UPDATED':
            return {
                ...state,
                overlays: {
                    ...state.overlays,
                    [action.id]: {
                        ...state.overlays[action.id],
                        config: action.config,
                        data: action.data,
                    },
                },
            };

        case 'OVERLAY_TOGGLED':
            return {
                ...state,
                overlays: {
                    ...state.overlays,
                    [action.id]: { ...state.overlays[action.id], visible: action.visible },
                },
            };

        case 'INDICATOR_ADDED':
            return { ...state, indicators: { ...state.indicators, [action.indicator.id]: action.indicator } };

        case 'INDICATOR_REMOVED': {
            const { [action.id]: _, ...rest } = state.indicators;
            return { ...state, indicators: rest };
        }

        case 'INDICATOR_UPDATED':
            return {
                ...state,
                indicators: {
                    ...state.indicators,
                    [action.id]: { ...state.indicators[action.id], ...action.updates },
                },
            };

        case 'INDICATOR_CONFIG_UPDATED':
            return {
                ...state,
                indicators: {
                    ...state.indicators,
                    [action.id]: { ...state.indicators[action.id], config: action.config },
                },
            };

        case 'INDICATOR_TOGGLED':
            return {
                ...state,
                indicators: {
                    ...state.indicators,
                    [action.id]: { ...state.indicators[action.id], visible: !state.indicators[action.id].visible },
                },
            };

        case 'MAIN_LEGEND_SET':
            return { ...state, mainLegend: action.legend };

        case 'OVERLAY_LEGEND_SET':
            if (state.overlayLegends[action.id] === action.legend) return state;
            return { ...state, overlayLegends: { ...state.overlayLegends, [action.id]: action.legend } };

        default:
            return state;
    }
}



// ============================================================================
// Context
// ============================================================================

type ChartContextType = {
    state: ChartState;
    // Refs (for imperative access)
    chartRef: React.RefObject<ReturnType<typeof createChart> | null>;
    candleSeriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>;
    overlaySeriesRef: React.RefObject<Map<string, OverlaySeriesEntry>>;
    syncingRef: React.RefObject<boolean>;
    // Action creators
    actions: {
        initChart: (chart: ReturnType<typeof createChart>, candleSeries: ISeriesApi<"Candlestick">) => void;
        destroyChart: () => void;
        addOverlay: (type: OverlayType) => string;
        removeOverlay: (id: string) => void;
        updateOverlayConfig: <T extends VolumeConfig | MAConfig | MarketBiasConfig | FibonacciConfig>(id: string, configUpdates: Partial<T>) => void;
        toggleOverlay: (id: string) => void;
        addIndicator: (type: IndicatorType) => string;
        removeIndicator: (id: string) => void;
        updateIndicator: (id: string, updates: Partial<SubIndicator>) => void;
        updateIndicatorConfig: <T extends MACDConfig | RSIConfig>(id: string, configUpdates: Partial<T>) => void;
        toggleIndicator: (id: string) => void;
        setMainLegend: (legend: MainLegend | null) => void;
        setOverlayLegend: (id: string, legend: OverlayLegend | undefined) => void;
    };
};

const ChartContext = createContext<ChartContextType | null>(null);

let idCounter = 0;
const generateId = (prefix: string) => `${prefix}-${++idCounter}`;



function createFibonacciSeriesExtras(
    chart: ReturnType<typeof createChart>,
    render: FibonacciRenderData,
    fibConfig: FibonacciConfig,
    showRetracement: boolean,
    showExtension: boolean,
    showTrendline: boolean,
): ISeriesApi<any>[] {
    const fibLineWidth = Math.min(4, Math.max(1, Math.round(fibConfig.lineWidth))) as 1 | 2 | 3 | 4;
    const extras: ISeriesApi<any>[] = [];

    // Zone BaselineSeries (dynamic count based on visible segments)
    for (const bandKey of fibonacciRetracementBandOrder) {
        const color = getRetracementBgColor(fibConfig, bandKey);
        for (const band of render.retracementZoneBands[bandKey]) {
            const series = chart.addSeries(BaselineSeries, {
                baseValue: { type: 'price' as const, price: band.bottomPrice },
                topFillColor1: color,
                topFillColor2: color,
                topLineColor: 'transparent',
                bottomFillColor1: 'transparent',
                bottomFillColor2: 'transparent',
                bottomLineColor: 'transparent',
                lineWidth: 1,
                lineVisible: false,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
            series.setData(band.data as any);
            series.applyOptions({ visible: showRetracement });
            extras.push(series);
        }
    }

    for (const bandKey of fibonacciExtensionBandOrder) {
        const color = getExtensionBgColor(fibConfig, bandKey);
        for (const band of render.extensionZoneBands[bandKey]) {
            const series = chart.addSeries(BaselineSeries, {
                baseValue: { type: 'price' as const, price: band.bottomPrice },
                topFillColor1: color,
                topFillColor2: color,
                topLineColor: 'transparent',
                bottomFillColor1: 'transparent',
                bottomFillColor2: 'transparent',
                bottomLineColor: 'transparent',
                lineWidth: 1,
                lineVisible: false,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
            series.setData(band.data as any);
            series.applyOptions({ visible: showExtension });
            extras.push(series);
        }
    }

    // Line series (fixed count: 7 retracement + 5 extension + 1 trendline)
    for (const levelKey of fibonacciRetracementLevelOrder) {
        const series = chart.addSeries(LineSeries, {
            color: getRetracementLineColor(fibConfig, levelKey),
            lineWidth: fibLineWidth,
            lineStyle: levelKey === 'level5' ? LineStyle.Dotted : LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        series.setData(render.retracementData[levelKey] as any);
        const levelVisible = showRetracement && (levelKey !== 'level5' || fibConfig.showMidline);
        series.applyOptions({ visible: levelVisible });
        extras.push(series);
    }

    for (const levelKey of fibonacciExtensionLevelOrder) {
        const series = chart.addSeries(LineSeries, {
            color: getExtensionLineColor(fibConfig, levelKey),
            lineWidth: fibLineWidth,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        series.setData(render.extensionData[levelKey] as any);
        series.applyOptions({ visible: showExtension });
        extras.push(series);
    }

    const trendlineSeries = chart.addSeries(LineSeries, {
        color: fibConfig.level0LineColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });
    trendlineSeries.setData(render.trendlineData as any);
    trendlineSeries.applyOptions({ visible: showTrendline });
    extras.push(trendlineSeries);

    return extras;
}


export function ChartProvider({ children }: { children: ReactNode; }) {
    const [state, dispatch] = useReducer(chartReducer, initialState);
    const candleData = useCandleData();

    // Refs for imperative chart access — NOT in React state
    const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const overlaySeriesRef = useRef<Map<string, OverlaySeriesEntry>>(new Map());
    const syncingRef = useRef(false);

    // We need a ref to read current state inside callbacks without re-creating them
    const stateRef = useRef(state);
    stateRef.current = state;

    // ── Action creators ──────────────────────────────────────────────────

    const initChart = useCallback((chart: ReturnType<typeof createChart>, candleSeries: ISeriesApi<"Candlestick">) => {
        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;

        // Create series for existing overlays (e.g. default volume)
        const currentState = stateRef.current;
        Object.values(currentState.overlays).forEach(overlay => {
            if (overlay.type === 'volume') {
                const config = overlay.config as VolumeConfig;
                const volumeSeries = createVolumeSeries(chart);
                const data = computeVolumeData(candleData, config);
                volumeSeries.setData(data as any);
                overlaySeriesRef.current.set(overlay.id, { primary: volumeSeries, extras: [] });

                // Adjust visibility + margins
                volumeSeries.applyOptions({ visible: overlay.visible });
                if (overlay.visible) {
                    volumeSeries.priceScale().applyOptions({
                        scaleMargins: { top: 0.8, bottom: 0 },
                    });
                    chart.priceScale('right').applyOptions({
                        scaleMargins: { top: 0.1, bottom: 0.2 },
                    });
                }

                dispatch({ type: 'OVERLAY_CONFIG_UPDATED', id: overlay.id, config: overlay.config, data });
            }
            if (overlay.type === 'sma' || overlay.type === 'ema') {
                const maConfig = overlay.config as MAConfig;
                const maSeries = createMASeries(chart, maConfig);
                const data = computeMAData(candleData, overlay.type, maConfig);
                maSeries.setData(data);
                maSeries.applyOptions({ visible: overlay.visible });
                overlaySeriesRef.current.set(overlay.id, { primary: maSeries, extras: [] });
                dispatch({ type: 'OVERLAY_CONFIG_UPDATED', id: overlay.id, config: overlay.config, data });
            }
            if (overlay.type === 'market-bias') {
                const mbConfig = overlay.config as MarketBiasConfig;
                const haSeries = chart.addSeries(CandlestickSeries, {
                    priceLineVisible: false,
                    lastValueVisible: false,
                    borderVisible: false,
                });
                const biasSeries = chart.addSeries(LineSeries, {
                    lineWidth: 4,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                });
                const data = computeMarketBiasData(candleData, mbConfig);
                haSeries.setData(data.map(point => ({
                    time: point.time, open: point.open, high: point.high, low: point.low, close: point.close,
                    color: point.candleColor, borderColor: point.candleColor, wickColor: point.candleColor,
                })) as any);
                biasSeries.setData(data.map(point => ({
                    time: point.time, value: point.avg, color: point.biasColor,
                })) as any);
                haSeries.applyOptions({ visible: overlay.visible && mbConfig.showHACandles });
                biasSeries.applyOptions({ visible: overlay.visible && mbConfig.showMarketBias });
                overlaySeriesRef.current.set(overlay.id, { primary: haSeries, extras: [biasSeries] });
                dispatch({ type: 'OVERLAY_CONFIG_UPDATED', id: overlay.id, config: overlay.config, data });
            }
            if (overlay.type === 'fibonacci') {
                const fibConfig = overlay.config as FibonacciConfig;
                const computed = computeFibonacciData(candleData, fibConfig);
                const render = buildFibonacciRenderData(candleData, computed, fibConfig);
                const showRetracement = overlay.visible && fibConfig.historyMode !== 0 && fibConfig.showRetracement;
                const showExtension = overlay.visible && fibConfig.historyMode !== 0 && fibConfig.showExtension;
                const showTrendline = overlay.visible && fibConfig.historyMode !== 0 && fibConfig.showTrendline;

                const supertrendSeries = chart.addSeries(LineSeries, {
                    lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
                });
                supertrendSeries.setData(render.supertrendData as any);
                supertrendSeries.applyOptions({ visible: overlay.visible && fibConfig.trendOn });

                const extras = createFibonacciSeriesExtras(chart, render, fibConfig, showRetracement, showExtension, showTrendline);
                overlaySeriesRef.current.set(overlay.id, { primary: supertrendSeries, extras });
                const data = [...computed.segments, ...computed.extensions];
                dispatch({ type: 'OVERLAY_CONFIG_UPDATED', id: overlay.id, config: overlay.config, data });
            }
        });
    }, [candleData]);

    const destroyChart = useCallback(() => {
        overlaySeriesRef.current.clear();
        chartRef.current = null;
        candleSeriesRef.current = null;
    }, []);

    const addOverlay = useCallback((type: OverlayType): string => {
        const chart = chartRef.current;
        const id = generateId(type);

        if (type === 'volume') {
            const config: VolumeConfig = { ...defaultVolumeConfig };
            let data: any[] = [];

            if (chart) {
                const volumeSeries = createVolumeSeries(chart);
                data = computeVolumeData(candleData, config);
                volumeSeries.setData(data as any);
                overlaySeriesRef.current.set(id, { primary: volumeSeries, extras: [] });

                volumeSeries.priceScale().applyOptions({
                    scaleMargins: { top: 0.8, bottom: 0 },
                });
                chart.priceScale('right').applyOptions({
                    scaleMargins: { top: 0.1, bottom: 0.2 },
                });
            }

            dispatch({ type: 'OVERLAY_ADDED', overlay: { id, type, visible: true, config, data } });
        }

        if (type === 'sma' || type === 'ema') {
            const config = getDefaultMAConfig(type);
            let data: any[] = [];

            if (chart) {
                const maSeries = createMASeries(chart, config);
                data = computeMAData(candleData, type, config);
                maSeries.setData(data);
                overlaySeriesRef.current.set(id, { primary: maSeries, extras: [] });
            }

            dispatch({ type: 'OVERLAY_ADDED', overlay: { id, type, visible: true, config, data } });
        }

        if (type === 'market-bias') {
            const config: MarketBiasConfig = { ...defaultMarketBiasConfig };
            let data: any[] = [];

            if (chart) {
                const haSeries = chart.addSeries(CandlestickSeries, {
                    priceLineVisible: false,
                    lastValueVisible: false,
                    borderVisible: false,
                });
                const biasSeries = chart.addSeries(LineSeries, {
                    lineWidth: 4,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                });

                data = computeMarketBiasData(candleData, config);
                haSeries.setData(data.map(point => ({
                    time: point.time,
                    open: point.open,
                    high: point.high,
                    low: point.low,
                    close: point.close,
                    color: point.candleColor,
                    borderColor: point.candleColor,
                    wickColor: point.candleColor,
                })) as any);
                biasSeries.setData(data.map(point => ({
                    time: point.time,
                    value: point.avg,
                    color: point.biasColor,
                })) as any);

                haSeries.applyOptions({ visible: config.showHACandles });
                biasSeries.applyOptions({ visible: config.showMarketBias });
                overlaySeriesRef.current.set(id, { primary: haSeries, extras: [biasSeries] });
            }

            dispatch({ type: 'OVERLAY_ADDED', overlay: { id, type, visible: true, config, data } });
        }

        if (type === 'fibonacci') {
            const config: FibonacciConfig = { ...defaultFibonacciConfig };
            let data: any[] = [];

            if (chart) {
                const computed = computeFibonacciData(candleData, config);
                const render = buildFibonacciRenderData(candleData, computed, config);
                const showRetracement = config.historyMode !== 0 && config.showRetracement;
                const showExtension = config.historyMode !== 0 && config.showExtension;
                const showTrendline = config.historyMode !== 0 && config.showTrendline;

                const supertrendSeries = chart.addSeries(LineSeries, {
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                });
                supertrendSeries.setData(render.supertrendData as any);
                supertrendSeries.applyOptions({ visible: config.trendOn });

                const extras = createFibonacciSeriesExtras(chart, render, config, showRetracement, showExtension, showTrendline);

                overlaySeriesRef.current.set(id, {
                    primary: supertrendSeries,
                    extras,
                });
                data = [...computed.segments, ...computed.extensions];
            }

            dispatch({ type: 'OVERLAY_ADDED', overlay: { id, type, visible: true, config, data } });
        }

        return id;
    }, [candleData]);

    const removeOverlay = useCallback((id: string) => {
        const chart = chartRef.current;
        const entry = overlaySeriesRef.current.get(id);
        if (chart && entry) {
            const allSeries = [entry.primary, ...entry.extras];
            allSeries.forEach(series => {
                try { chart.removeSeries(series); } catch { /* already removed */ }
            });
            overlaySeriesRef.current.delete(id);
        }

        // Adjust margins if no volume visible
        if (chart) {
            const currentState = stateRef.current;
            const remainingVolumeVisible = Object.values(currentState.overlays).some(
                o => o.type === 'volume' && o.id !== id && o.visible
            );
            if (!remainingVolumeVisible) {
                chart.priceScale('right').applyOptions({
                    scaleMargins: { top: 0.1, bottom: 0 },
                });
            }
        }

        dispatch({ type: 'OVERLAY_REMOVED', id });
    }, []);

    const updateOverlayConfig = useCallback(<T extends VolumeConfig | MAConfig | MarketBiasConfig | FibonacciConfig>(id: string, configUpdates: Partial<T>) => {
        const currentState = stateRef.current;
        const overlay = currentState.overlays[id];
        if (!overlay) return;

        const entry = overlaySeriesRef.current.get(id);
        const newConfig = { ...overlay.config, ...configUpdates } as T;

        if (overlay.type === 'volume') {
            const data = computeVolumeData(candleData, newConfig as VolumeConfig);
            if (entry) entry.primary.setData(data as any);
            dispatch({ type: 'OVERLAY_CONFIG_UPDATED', id, config: newConfig, data });
        }

        if (overlay.type === 'sma' || overlay.type === 'ema') {
            const maConfig = newConfig as MAConfig;
            const series = entry?.primary;

            // Apply style options
            if (series && ('color' in configUpdates || 'lineWidth' in configUpdates)) {
                series.applyOptions({
                    color: maConfig.color,
                    lineWidth: maConfig.lineWidth as 1 | 2 | 3 | 4,
                });
            }

            // Recompute data (always — period, color, or any change triggers this)
            const data = computeMAData(candleData, overlay.type, maConfig);
            if (series) series.setData(data);

            dispatch({ type: 'OVERLAY_CONFIG_UPDATED', id, config: newConfig, data });
        }

        if (overlay.type === 'market-bias') {
            const marketBiasConfig = newConfig as MarketBiasConfig;
            const data = computeMarketBiasData(candleData, marketBiasConfig);
            const haSeries = entry?.primary;
            const biasSeries = entry?.extras[0];

            if (haSeries) {
                haSeries.setData(data.map(point => ({
                    time: point.time,
                    open: point.open,
                    high: point.high,
                    low: point.low,
                    close: point.close,
                    color: point.candleColor,
                    borderColor: point.candleColor,
                    wickColor: point.candleColor,
                })) as any);
                haSeries.applyOptions({ visible: overlay.visible && marketBiasConfig.showHACandles });
            }

            if (biasSeries) {
                biasSeries.setData(data.map(point => ({
                    time: point.time,
                    value: point.avg,
                    color: point.biasColor,
                })) as any);
                biasSeries.applyOptions({ visible: overlay.visible && marketBiasConfig.showMarketBias });
            }

            dispatch({ type: 'OVERLAY_CONFIG_UPDATED', id, config: newConfig, data });
        }

        if (overlay.type === 'fibonacci') {
            const fibConfig = newConfig as FibonacciConfig;
            const computed = computeFibonacciData(candleData, fibConfig);
            const render = buildFibonacciRenderData(candleData, computed, fibConfig);
            const showRetracement = overlay.visible && fibConfig.historyMode !== 0 && fibConfig.showRetracement;
            const showExtension = overlay.visible && fibConfig.historyMode !== 0 && fibConfig.showExtension;
            const showTrendline = overlay.visible && fibConfig.historyMode !== 0 && fibConfig.showTrendline;

            const chart = chartRef.current;
            let targetEntry = entry;

            if (!targetEntry && chart) {
                const supertrendSeries = chart.addSeries(LineSeries, {
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                });
                targetEntry = { primary: supertrendSeries, extras: [] };
                overlaySeriesRef.current.set(id, targetEntry);
            }

            if (targetEntry && chart) {
                // Update primary (supertrend) in place
                targetEntry.primary.setData(render.supertrendData as any);
                targetEntry.primary.applyOptions({
                    visible: overlay.visible && fibConfig.trendOn,
                });

                // Remove all old extras and recreate (handles dynamic zone series count)
                for (const s of targetEntry.extras) {
                    try { chart.removeSeries(s); } catch { /* already removed */ }
                }
                targetEntry.extras = createFibonacciSeriesExtras(chart, render, fibConfig, showRetracement, showExtension, showTrendline);
            }

            dispatch({ type: 'OVERLAY_CONFIG_UPDATED', id, config: newConfig, data: [...computed.segments, ...computed.extensions] });
        }
    }, [candleData]);

    const toggleOverlay = useCallback((id: string) => {
        const chart = chartRef.current;
        const currentState = stateRef.current;
        const overlay = currentState.overlays[id];
        if (!overlay) return;

        const newVisible = !overlay.visible;
        const entry = overlaySeriesRef.current.get(id);

        if (entry) {
            if (overlay.type === 'volume' || overlay.type === 'sma' || overlay.type === 'ema') {
                entry.primary.applyOptions({ visible: newVisible });
            }

            if (overlay.type === 'market-bias') {
                const config = overlay.config as MarketBiasConfig;
                entry.primary.applyOptions({ visible: newVisible && config.showHACandles });
                entry.extras[0]?.applyOptions({ visible: newVisible && config.showMarketBias });
            }

            if (overlay.type === 'fibonacci') {
                const config = overlay.config as FibonacciConfig;
                const showRetracement = newVisible && config.historyMode !== 0 && config.showRetracement;
                const showExtension = newVisible && config.historyMode !== 0 && config.showExtension;
                const showTrendline = newVisible && config.historyMode !== 0 && config.showTrendline;
                entry.primary.applyOptions({ visible: newVisible && config.trendOn });

                // Zone series have dynamic count; line series are the last 13 entries (7 retracement + 5 extension + 1 trendline)
                const fixedLineCount = fibonacciRetracementLevelOrder.length + fibonacciExtensionLevelOrder.length + 1;
                const zoneCount = entry.extras.length - fixedLineCount;
                const lineStart = zoneCount;

                // Toggle zone series visibility
                for (let i = 0; i < zoneCount; i++) {
                    entry.extras[i]?.applyOptions({ visible: showRetracement || showExtension });
                }

                // Toggle retracement line series
                fibonacciRetracementLevelOrder.forEach((levelKey, index) => {
                    const levelVisible = showRetracement && (levelKey !== 'level5' || config.showMidline);
                    entry.extras[lineStart + index]?.applyOptions({ visible: levelVisible });
                });

                // Toggle extension line series
                const extLineStart = lineStart + fibonacciRetracementLevelOrder.length;
                fibonacciExtensionLevelOrder.forEach((_, index) => {
                    entry.extras[extLineStart + index]?.applyOptions({ visible: showExtension });
                });

                // Toggle trendline
                const trendlineIdx = entry.extras.length - 1;
                entry.extras[trendlineIdx]?.applyOptions({ visible: showTrendline });
            }

            if (overlay.type === 'volume' && newVisible) {
                entry.primary.priceScale().applyOptions({
                    scaleMargins: { top: 0.8, bottom: 0 },
                });
            }
        }

        // Adjust main chart margins based on volume visibility
        if (chart && overlay.type === 'volume') {
            const anyVolumeVisible = Object.values(currentState.overlays).some(
                o => o.type === 'volume' && (o.id === id ? newVisible : o.visible)
            );
            chart.priceScale('right').applyOptions({
                scaleMargins: { top: 0.1, bottom: anyVolumeVisible ? 0.2 : 0 },
            });
        }

        dispatch({ type: 'OVERLAY_TOGGLED', id, visible: newVisible });
    }, []);

    // Indicator actions
    const addIndicator = useCallback((type: IndicatorType): string => {
        const id = generateId(type);
        let config: SubIndicator['config'];

        switch (type) {
            case 'macd':
                config = { ...defaultMACDConfig };
                break;
            case 'rsi':
                config = { ...defaultRSIConfig };
                break;
        }

        dispatch({ type: 'INDICATOR_ADDED', indicator: { id, type, visible: true, config } });
        return id;
    }, []);

    const removeIndicator = useCallback((id: string) => {
        dispatch({ type: 'INDICATOR_REMOVED', id });
    }, []);

    const updateIndicator = useCallback((id: string, updates: Partial<SubIndicator>) => {
        dispatch({ type: 'INDICATOR_UPDATED', id, updates });
    }, []);

    const updateIndicatorConfig = useCallback(<T extends MACDConfig | RSIConfig>(id: string, configUpdates: Partial<T>) => {
        const currentState = stateRef.current;
        const indicator = currentState.indicators[id];
        if (!indicator) return;
        const newConfig = { ...indicator.config, ...configUpdates } as T;
        dispatch({ type: 'INDICATOR_CONFIG_UPDATED', id, config: newConfig });
    }, []);

    const toggleIndicator = useCallback((id: string) => {
        dispatch({ type: 'INDICATOR_TOGGLED', id });
    }, []);

    // Legend actions
    const setMainLegend = useCallback((legend: MainLegend | null) => {
        dispatch({ type: 'MAIN_LEGEND_SET', legend });
    }, []);

    const setOverlayLegend = useCallback((id: string, legend: OverlayLegend | undefined) => {
        dispatch({ type: 'OVERLAY_LEGEND_SET', id, legend });
    }, []);

    const actions = useMemo(() => ({
        initChart,
        destroyChart,
        addOverlay,
        removeOverlay,
        updateOverlayConfig,
        toggleOverlay,
        addIndicator,
        removeIndicator,
        updateIndicator,
        updateIndicatorConfig,
        toggleIndicator,
        setMainLegend,
        setOverlayLegend,
    }), [initChart, destroyChart, addOverlay, removeOverlay, updateOverlayConfig, toggleOverlay,
        addIndicator, removeIndicator, updateIndicator, updateIndicatorConfig, toggleIndicator,
        setMainLegend, setOverlayLegend]);

    return (
        <ChartContext.Provider value={{ state, chartRef, candleSeriesRef, overlaySeriesRef, syncingRef, actions }}>
            {children}
        </ChartContext.Provider>
    );
}

// ============================================================================
// Hooks
// ============================================================================

function useChartContext() {
    const context = useContext(ChartContext);
    if (!context) {
        throw new Error('useChartContext must be used within a ChartProvider');
    }
    return context;
}

export function useChart() {
    const { chartRef, candleSeriesRef, syncingRef, actions } = useChartContext();
    return { chartRef, candleSeriesRef, syncingRef, actions };
}

export function useOverlays() {
    const { state, overlaySeriesRef, actions } = useChartContext();
    const overlays = state.overlays;
    return {
        overlays,
        overlaySeriesRef,
        addOverlay: actions.addOverlay,
        removeOverlay: actions.removeOverlay,
        updateOverlayConfig: actions.updateOverlayConfig,
        toggleOverlay: actions.toggleOverlay,
    };
}

export function useIndicators() {
    const { state, actions } = useChartContext();
    const indicators = state.indicators;

    const getIndicator = useCallback((id: string) => indicators[id], [indicators]);

    return {
        indicators,
        getIndicator,
        addIndicator: actions.addIndicator,
        removeIndicator: actions.removeIndicator,
        updateIndicator: actions.updateIndicator,
        updateIndicatorConfig: actions.updateIndicatorConfig,
        toggleIndicator: actions.toggleIndicator,
    };
}

export function useLegend() {
    const { state, actions } = useChartContext();
    return {
        mainLegend: state.mainLegend,
        overlayLegends: state.overlayLegends,
        setMainLegend: actions.setMainLegend,
        setOverlayLegend: actions.setOverlayLegend,
    };
}
