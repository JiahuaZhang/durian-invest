import type { createChart } from 'lightweight-charts';
import { Settings, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCandleData, useChart, useIndicators } from '../../../context/ChartContext';
import { ChartConfigPopup } from '../../ChartConfigPopup';
import { buildMetaTabs } from '../meta';
import { defaultMACDConfig, MACDConfig, MACDMeta, type MACDData } from './macd';
import {
    computeMACDData,
    createMACDChart,
    subscribeLegend,
    syncCrosshair,
    syncTimeScale,
    type MACDSeriesRefs,
} from './macd.indicator';

type MACDChartProps = {
    id: string;
};

export function MACDChart({ id }: MACDChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
    const seriesRef = useRef<MACDSeriesRefs | null>(null);
    const [legend, setLegend] = useState<MACDData | null>(null);
    const [configOpen, setConfigOpen] = useState(false);
    const cogRef = useRef<HTMLButtonElement>(null);

    const { chartRef: mainChartRef, candleSeriesRef, syncingRef } = useChart();
    const data = useCandleData();
    const { getIndicator, updateIndicator, removeIndicator, updateIndicatorConfig } = useIndicators();

    const indicator = getIndicator(id);
    const macdConfig = indicator?.config as MACDConfig ?? defaultMACDConfig;

    const configTabs = buildMetaTabs(MACDMeta, macdConfig, (updates) => updateIndicatorConfig(id, updates));

    // Single effect: compute data, create chart, set up syncing, legend
    useEffect(() => {
        if (!containerRef.current || data.length === 0) return;

        // Compute
        const { macdData, crosses, divergences } = computeMACDData(data, macdConfig);

        // Create chart
        const { chart, series } = createMACDChart(containerRef.current, macdData, macdConfig, divergences);
        chartRef.current = chart;
        seriesRef.current = series;

        // Push data to context (one-time, not in a dependency-tracked way)
        updateIndicator(id, {
            chart,
            series,
            data: { macdData, crosses, divergences },
        });

        // Set up syncing
        const cleanups: (() => void)[] = [];

        const mainChart = mainChartRef.current;
        if (mainChart) {
            cleanups.push(syncTimeScale(chart, mainChart, syncingRef));

            const candleSeries = candleSeriesRef.current;
            if (candleSeries) {
                cleanups.push(syncCrosshair(chart, mainChart, series.histogram, candleSeries));
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
    }, [id, data, macdConfig]);

    if (!indicator) return null;

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
