import { createChart, createSeriesMarkers, HistogramSeries, ISeriesApi, LineSeries } from 'lightweight-charts';
import { Settings, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCandleData, useChart, useIndicators } from '../../context/ChartContext';
import { MACDConfig } from './macd';
import { ChartConfigPopup } from '../../ChartConfigPopup';
import { buildMetaTabs } from '../meta';
import { calcMACD, findMACDCrosses, findMACDDivergences, MACDData, MACDMeta } from './macd';

type MACDChartProps = {
    id: string;
};

export function MACDChart({ id }: MACDChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const seriesRef = useRef<{
        histogram?: ISeriesApi<"Histogram">;
        macd?: ISeriesApi<"Line">;
        signal?: ISeriesApi<"Line">;
    }>({});
    const [chart, setChart] = useState<ReturnType<typeof createChart> | null>(null);
    const [legend, setLegend] = useState<MACDData | null>(null);
    const [configOpen, setConfigOpen] = useState(false);
    const cogRef = useRef<HTMLButtonElement>(null);

    const { chartRef: mainChartRef, candleSeriesRef, syncingRef } = useChart();
    const data = useCandleData();
    const { getIndicator, updateIndicator, removeIndicator, updateIndicatorConfig } = useIndicators();

    const indicator = getIndicator(id);
    const macdConfig = indicator?.config as MACDConfig;

    const macdData = useMemo(() => {
        if (!macdConfig || data.length === 0) return [];
        return calcMACD(data, {
            fast: macdConfig.fastPeriod,
            slow: macdConfig.slowPeriod,
            signal: macdConfig.signalPeriod,
        });
    }, [data, macdConfig?.fastPeriod, macdConfig?.slowPeriod, macdConfig?.signalPeriod]);

    const crosses = useMemo(() => findMACDCrosses(macdData), [macdData]);

    const divergences = useMemo(() => {
        if (!macdConfig?.showDivergences || data.length === 0) return [];
        return findMACDDivergences(data, macdData, {
            pivotLookbackLeft: macdConfig.pivotLookbackLeft,
            pivotLookbackRight: macdConfig.pivotLookbackRight,
            rangeMin: macdConfig.rangeMin,
            rangeMax: macdConfig.rangeMax,
            dontTouchZero: macdConfig.dontTouchZero,
        });
    }, [data, macdData, macdConfig?.showDivergences, macdConfig?.pivotLookbackLeft,
        macdConfig?.pivotLookbackRight, macdConfig?.rangeMin, macdConfig?.rangeMax, macdConfig?.dontTouchZero]);

    const configTabs = useMemo(() => {
        if (!macdConfig) return [];
        return buildMetaTabs(MACDMeta, macdConfig, (updates) => updateIndicatorConfig(id, updates));
    }, [id, macdConfig, updateIndicatorConfig]);

    // Sync computed data to context
    useEffect(() => {
        updateIndicator(id, { data: { macdData, crosses, divergences } });
    }, [id, macdData, crosses, divergences, updateIndicator]);

    // Create chart
    useEffect(() => {
        if (!containerRef.current || data.length === 0 || !macdConfig) return;

        const newChart = createChart(containerRef.current);

        // 4-color histogram
        const histogramData = macdData.filter(d => d.histogram !== undefined).map((d, i, arr) => {
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

        const histogramSeries = newChart.addSeries(HistogramSeries, {
            priceLineVisible: false,
            lastValueVisible: false,
        });
        histogramSeries.setData(histogramData as any);

        const macdLineSeries = newChart.addSeries(LineSeries, {
            color: macdConfig.macdColor,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        macdLineSeries.setData(macdData.map(d => ({ time: d.time, value: d.macd })) as any);

        const signalLineSeries = newChart.addSeries(LineSeries, {
            color: macdConfig.signalColor,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        signalLineSeries.setData(macdData.map(d => ({ time: d.time, value: d.signal })) as any);

        // Add divergence lines and markers
        if (macdConfig.showDivergences && divergences.length > 0) {
            divergences.forEach(div => {
                const color = div.type === 'bullish' ? macdConfig.divergenceBullColor : macdConfig.divergenceBearColor;
                const startTime = macdData[div.startIndex]?.time;
                const endTime = macdData[div.endIndex]?.time;

                if (startTime && endTime) {
                    const lineSeries = newChart.addSeries(LineSeries, {
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
                        color: div.type === 'bullish' ? macdConfig.divergenceBullColor : macdConfig.divergenceBearColor,
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

        seriesRef.current = { histogram: histogramSeries, macd: macdLineSeries, signal: signalLineSeries };
        setChart(newChart);

        // Register with context
        updateIndicator(id, { chart: newChart, series: seriesRef.current });

        return () => {
            newChart.remove();
            setChart(null);
        };
    }, [id, data, macdData, divergences, macdConfig?.macdColor, macdConfig?.signalColor,
        macdConfig?.showDivergences, macdConfig?.divergenceBullColor, macdConfig?.divergenceBearColor, updateIndicator]);

    // Sync time scale with main chart
    useEffect(() => {
        const mainChart = mainChartRef.current;
        if (!chart || !mainChart) return;

        const handleMainRangeChange = (range: any) => {
            if (syncingRef.current || !range) return;
            syncingRef.current = true;
            chart.timeScale().setVisibleLogicalRange(range);
            syncingRef.current = false;
        };

        const handleAuxRangeChange = (range: any) => {
            if (syncingRef.current || !range) return;
            syncingRef.current = true;
            mainChart.timeScale().setVisibleLogicalRange(range);
            syncingRef.current = false;
        };

        mainChart.timeScale().subscribeVisibleLogicalRangeChange(handleMainRangeChange);
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleAuxRangeChange);

        return () => {
            mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleMainRangeChange);
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleAuxRangeChange);
        };
    }, [chart, mainChartRef, syncingRef]);

    // Sync crosshair with main chart
    useEffect(() => {
        const mainChart = mainChartRef.current;
        const candleSeries = candleSeriesRef.current;
        if (!chart || !mainChart) return;
        const { histogram } = seriesRef.current;
        if (!histogram || !candleSeries) return;

        const mainToAux = (param: any) => {
            if (param.time) {
                chart.setCrosshairPosition(0, param.time, histogram);
            } else {
                chart.clearCrosshairPosition();
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
        chart.subscribeCrosshairMove(auxToMain);

        return () => {
            mainChart.unsubscribeCrosshairMove(mainToAux);
            chart.unsubscribeCrosshairMove(auxToMain);
        };
    }, [chart, mainChartRef, candleSeriesRef]);

    // Handle crosshair for legend
    useEffect(() => {
        if (!chart) return;

        const { histogram, macd, signal } = seriesRef.current;
        if (!histogram || !macd || !signal) return;

        const handleCrosshair = (param: any) => {
            if (param.time) {
                const h = param.seriesData.get(histogram) as any;
                const m = param.seriesData.get(macd) as any;
                const s = param.seriesData.get(signal) as any;
                setLegend({
                    time: param.time,
                    histogram: h?.value,
                    macd: m?.value,
                    signal: s?.value,
                });
            } else {
                setLegend(null);
            }
        };

        chart.subscribeCrosshairMove(handleCrosshair);
        return () => chart.unsubscribeCrosshairMove(handleCrosshair);
    }, [chart]);

    if (!indicator || !macdConfig) return null;

    return (
        <div
            un-w="6xl"
            un-h="60"
            un-border="~ slate-200"
            un-shadow="sm"
            un-position='relative'
        >
            <div un-position="absolute top-2 left-2 z-10" un-text="xs" un-flex="~ items-center gap-2">
                <button
                    ref={cogRef}
                    onClick={() => setConfigOpen(p => !p)}
                    un-p="1"
                    un-cursor="pointer"
                    un-text="slate-400 hover:slate-600"
                    un-bg="transparent hover:slate-100"
                    un-border="rounded"
                >
                    <Settings size={14} />
                </button>
                <span>MACD {macdConfig.fastPeriod} {macdConfig.slowPeriod} {macdConfig.signalPeriod}</span>
                {legend && (
                    <>
                        <span un-text="blue-600">{legend.macd?.toFixed(2)}</span>
                        <span un-text="orange-600">{legend.signal?.toFixed(2)}</span>
                        <span un-text={(legend.histogram ?? 0) >= 0 ? 'green-600' : 'red-600'}>{legend.histogram?.toFixed(2)}</span>
                    </>
                )}
                <ChartConfigPopup
                    title="MACD Settings"
                    isOpen={configOpen}
                    onClose={() => setConfigOpen(false)}
                    triggerRef={cogRef}
                    tabs={configTabs}
                />
            </div>

            <button
                onClick={() => removeIndicator(id)}
                un-position="absolute top-2 right-2 z-10"
                un-p="1"
                un-cursor="pointer"
                un-text="slate-400 hover:red-600"
                un-bg="transparent hover:slate-100"
                un-border="rounded"
            >
                <X size={14} />
            </button>

            <div ref={containerRef} un-h='full' />
        </div>
    );
}
