import type { createChart } from 'lightweight-charts';
import { Settings, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCandleData, useChart, useIndicators } from '../../../context/ChartContext';
import { ChartConfigPopup } from '../../ChartConfigPopup';
import { buildMetaTabs } from '../meta';
import { defaultRSIConfig, getRSISourceLabel, RSIMeta, RSISmoothing, type RSIConfig } from './rsi';
import {
    computeRSIData,
    createRSIChart,
    subscribeLegend,
    syncCrosshair,
    syncTimeScale,
    type RSILegend,
    type RSISeriesRefs,
} from './rsi.indicator';

type RSIChartProps = {
    id: string;
};

const formatValue = (value: number | undefined) => value === undefined ? '--' : value.toFixed(2);

export function RSIChart({ id }: RSIChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
    const seriesRef = useRef<RSISeriesRefs | null>(null);
    const [legend, setLegend] = useState<RSILegend | null>(null);
    const [configOpen, setConfigOpen] = useState(false);
    const cogRef = useRef<HTMLButtonElement>(null);

    const { chartRef: mainChartRef, candleSeriesRef, syncingRef } = useChart();
    const candleData = useCandleData();
    const { getIndicator, updateIndicator, removeIndicator, updateIndicatorConfig } = useIndicators();

    const indicator = getIndicator(id);
    const rsiConfig = indicator?.config as RSIConfig ?? defaultRSIConfig;

    const configTabs = buildMetaTabs(RSIMeta, rsiConfig, (updates) => updateIndicatorConfig(id, updates));

    // Single effect: compute data, create chart, set up syncing, legend
    useEffect(() => {
        if (!containerRef.current || candleData.length === 0) return;

        // Compute
        const { rsiData, divergences } = computeRSIData(candleData, rsiConfig);

        // Create chart
        const { chart, series } = createRSIChart(containerRef.current, candleData, rsiData, rsiConfig, divergences);
        chartRef.current = chart;
        seriesRef.current = series;

        // Push data to context once
        updateIndicator(id, {
            chart,
            series,
            data: { rsiData, divergences },
        });

        // Set up syncing
        const cleanups: (() => void)[] = [];

        const mainChart = mainChartRef.current;
        if (mainChart) {
            cleanups.push(syncTimeScale(chart, mainChart, syncingRef));

            const candleSeries = candleSeriesRef.current;
            if (candleSeries) {
                cleanups.push(syncCrosshair(chart, mainChart, series.rsi, candleSeries));
            }
        }

        // Legend
        cleanups.push(subscribeLegend(chart, series, setLegend));

        return () => {
            cleanups.forEach(fn => fn());
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, candleData, rsiConfig]);

    if (!indicator) return null;

    return (
        <div
            un-w="6xl"
            un-h="60"
            un-border="~ slate-200"
            un-shadow="sm"
            un-position="relative"
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

                <span>
                    RSI {rsiConfig.period} {getRSISourceLabel(rsiConfig.source)}
                </span>
                <span un-text="violet-600">{formatValue(legend?.rsi)}</span>
                {rsiConfig.smoothingType !== RSISmoothing.None && (
                    <span un-text="orange-600">{formatValue(legend?.ma)}</span>
                )}
                {rsiConfig.smoothingType === RSISmoothing.SMABB && (
                    <>
                        <span un-text="slate-500">{formatValue(legend?.bbUpper)}</span>
                        <span un-text="slate-500">{formatValue(legend?.bbLower)}</span>
                    </>
                )}

                <ChartConfigPopup
                    title="RSI Settings"
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

            <div ref={containerRef} un-h="full" />
        </div>
    );
}
