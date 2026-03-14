import { CandlestickSeries, createChart, createSeriesMarkers, HistogramData, LineData, Time } from 'lightweight-charts';
import { Settings } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ChartProvider, useCandleData, useChart, useIndicators, useLegend, useOverlays } from '../context/ChartContext';
import { AuxiliaryChart } from './AuxiliaryChart';
import { ChartLegend } from './ChartLegend';
import type { MAConfig } from './plugin/moving-average/ma';
import { buildMACrossMarkers } from './plugin/moving-average/ma';

const AddButton = ({ onClick, children }: { onClick: () => void, children: React.ReactNode; }) => (
    <button
        onClick={onClick}
        un-p="x-3 y-1"
        un-text="xs slate-600"
        un-bg="white hover:slate-100"
        un-border="~ slate-200 rounded-md"
        un-shadow="sm"
        un-cursor="pointer"
    >
        {children}
    </button>
);

function CandleAnalysisInner() {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const data = useCandleData();
    const { chartRef, candleSeriesRef, actions } = useChart();
    const { overlays, overlaySeriesRef, addOverlay } = useOverlays();
    const { addIndicator } = useIndicators();
    const { setMainLegend, setOverlayLegend } = useLegend();

    // Convert overlays record to array for iteration
    const overlayList = Object.values(overlays);

    // Create main chart — one-time init, imperative
    useEffect(() => {
        if (!chartContainerRef.current || data.length === 0) return;

        const newChart = createChart(chartContainerRef.current);
        const mainSeries = newChart.addSeries(CandlestickSeries);
        mainSeries.setData(data as any);

        // Register with context — this also creates series for default overlays
        actions.initChart(newChart, mainSeries);

        return () => {
            newChart.remove();
            actions.destroyChart();
        };
    }, [data]);

    // Handle crosshair for legend
    const overlaysRef = useRef(overlayList);
    overlaysRef.current = overlayList;
    const overlaySeriesRefValue = overlaySeriesRef;

    useEffect(() => {
        const chart = chartRef.current;
        const candleSeries = candleSeriesRef.current;
        if (!chart || !candleSeries) return;

        const handleCrosshair = (param: any) => {
            const isHovering = param.point !== undefined && param.time !== undefined &&
                param.point.x >= 0 && param.point.x < chartContainerRef.current!.clientWidth &&
                param.point.y >= 0 && param.point.y < chartContainerRef.current!.clientHeight;

            if (param.time && isHovering) {
                const mainData = param.seriesData.get(candleSeries) as any;
                if (mainData) {
                    setMainLegend({
                        open: mainData.open,
                        high: mainData.high,
                        low: mainData.low,
                        close: mainData.close,
                    });
                }

                // Update overlay legends
                const currentOverlays = overlaysRef.current;
                const seriesMap = overlaySeriesRefValue.current;
                currentOverlays.forEach(overlay => {
                    const entry = seriesMap.get(overlay.id);
                    const series = entry?.primary;
                    if (!series) return;

                    if (overlay.type === 'volume') {
                        const vData = param.seriesData.get(series) as HistogramData<Time> | undefined;
                        if (vData?.value !== undefined) {
                            setOverlayLegend(overlay.id, { volume: vData.value });
                        }
                    }
                    if (overlay.type === 'sma' || overlay.type === 'ema') {
                        const lineData = param.seriesData.get(series) as LineData<Time> | undefined;
                        if (lineData?.value !== undefined) {
                            setOverlayLegend(overlay.id, { value: lineData.value });
                        }
                    }
                    if (overlay.type === 'fibonacci') {
                        const lineData = param.seriesData.get(series) as LineData<Time> | undefined;
                        if (lineData?.value !== undefined) {
                            setOverlayLegend(overlay.id, { value: lineData.value });
                        }
                    }
                    if (overlay.type === 'vwap') {
                        const lineData = param.seriesData.get(series) as LineData<Time> | undefined;
                        if (lineData?.value !== undefined) {
                            setOverlayLegend(overlay.id, { value: lineData.value });
                        }
                    }
                    if (overlay.type === 'market-bias') {
                        const mbData = param.seriesData.get(series) as any;
                        if (mbData?.open !== undefined && mbData?.high !== undefined &&
                            mbData?.low !== undefined && mbData?.close !== undefined) {
                            setOverlayLegend(overlay.id, {
                                open: mbData.open,
                                high: mbData.high,
                                low: mbData.low,
                                close: mbData.close,
                            });
                        }
                    }
                });
            } else {
                setMainLegend(null);
                const currentOverlays = overlaysRef.current;
                currentOverlays.forEach(overlay => {
                    setOverlayLegend(overlay.id, undefined);
                });
            }
        };

        chart.subscribeCrosshairMove(handleCrosshair);
        return () => chart.unsubscribeCrosshairMove(handleCrosshair);
    }, [chartRef, candleSeriesRef, overlaySeriesRefValue, setMainLegend, setOverlayLegend]);

    // Render cross signal markers on the candlestick series
    const maOverlaysWithSignals = overlayList.filter(o =>
        (o.type === 'sma' || o.type === 'ema') && o.visible &&
        (o.config as MAConfig).showCrossSignals &&
        o.data?.length > 0
    )

    useEffect(() => {
        const candleSeries = candleSeriesRef.current;
        if (!candleSeries) return;

        const allMarkers = buildMACrossMarkers(maOverlaysWithSignals, data);

        const plugin = createSeriesMarkers(candleSeries, allMarkers as any);

        return () => {
            plugin.detach();
        };
    }, [candleSeriesRef, data, maOverlaysWithSignals]);

    return (
        <div un-flex="~ col gap-4">
            <div un-flex="~">
                <div un-flex="~ items-center gap-2" un-bg="slate-50" un-p="2 r-4" un-border="~ slate-200 rounded-lg">
                    <Settings size={16} un-mr='2' />
                    <AddButton onClick={() => addOverlay('volume')}>
                        + Volume
                    </AddButton>
                    <AddButton onClick={() => addOverlay('sma')}>
                        + SMA
                    </AddButton>
                    <AddButton onClick={() => addOverlay('ema')}>
                        + EMA
                    </AddButton>
                    <AddButton onClick={() => addOverlay('market-bias')}>
                        + Market Bias
                    </AddButton>
                    <AddButton onClick={() => addOverlay('fibonacci')}>
                        + Fibonacci
                    </AddButton>
                    <AddButton onClick={() => addOverlay('fibonacci-ext')}>
                        + Fib Extension
                    </AddButton>
                    <AddButton onClick={() => addOverlay('vwap')}>
                        + VWAP
                    </AddButton>
                    <AddButton onClick={() => addIndicator('macd')}>
                        + MACD
                    </AddButton>
                    <AddButton onClick={() => addIndicator('rsi')}>
                        + RSI
                    </AddButton>
                </div>
            </div>

            <div un-flex="~ gap-4">
                <div
                    un-w="6xl"
                    un-h="xl"
                    un-border="~ slate-200"
                    un-shadow="sm"
                    un-position='relative'
                >
                    <ChartLegend />
                    <div ref={chartContainerRef} un-h='full' un-position='relative' />
                </div>

                {/* <TechnicalSignals /> */}
            </div>

            <AuxiliaryChart />
        </div>
    );
}

export function CandleAnalysis() {
    return (
        <ChartProvider>
            <CandleAnalysisInner />
        </ChartProvider>
    );
}
