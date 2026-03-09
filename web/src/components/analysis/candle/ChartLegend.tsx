import { type EMALegend, type FibExtLegend, type FibonacciLegend, type MainLegend, type MarketBiasLegend, type OverlayIndicator, type SMALegend, type VolumeConfig, type VolumeLegend, type VWAPLegend, useLegend, useOverlays } from "../context/ChartContext";
import { FibonacciMeta, getFibonacciHistoryModeLabel, type FibonacciConfig } from "./plugin/fibonacci/fibonacci";
import { FibExtMeta, type FibExtConfig } from "./plugin/fibonacci-ext/fibonacci-ext";
import { MarketBiasMeta, type MarketBiasConfig } from "./plugin/market-bias/market-bias";
import type { MAConfig } from "./plugin/moving-average/ma";
import { VWAPMeta, type VWAPConfig } from "./plugin/volume-weighted-average-price/vwap";
import { Eye, EyeOff, Settings, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ChartConfigPopup } from "./ChartConfigPopup";
import { buildMetaTabs } from "./plugin/meta";
import { MAMeta } from "./plugin/moving-average/ma";
import { VolumeMeta } from "./plugin/volume/volume";

const formatPrice = (val: number) => val.toFixed(2)
const formatVol = (val: number) => {
    if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B'
    if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M'
    if (val >= 1e3) return (val / 1e3).toFixed(2) + 'K'
    return val.toString()
}
const getColor = (d: MainLegend) => d.close >= d.open ? '#26a69a' : '#ef5350'
export const UnoTrick = <div un-text="#26a69a #ef5350" />

const getOverlayLabel = (overlay: OverlayIndicator) => {
    switch (overlay.type) {
        case 'volume': return 'Vol';
        case 'sma': return `SMA(${(overlay.config as MAConfig).period})`;
        case 'ema': return `EMA(${(overlay.config as MAConfig).period})`;
        case 'market-bias': {
            const config = overlay.config as MarketBiasConfig;
            return `MB(${config.period}/${config.smoothing}/${config.oscillatorPeriod})`;
        }
        case 'fibonacci': {
            const config = overlay.config as FibonacciConfig;
            return `Fib(${config.trendFactor}, ${getFibonacciHistoryModeLabel(config.historyMode)})`;
        }
        case 'fibonacci-ext': {
            const config = overlay.config as FibExtConfig;
            return `FibExt(${config.deviation}, ${config.depth})`;
        }
        case 'vwap': {
            const config = overlay.config as VWAPConfig;
            return `VWAP(${config.barsBack})`;
        }
        default: return overlay.type;
    }
}

// Get formatted value for overlay based on type
const getOverlayValueFromLegend = (
    type: string,
    legend: VolumeLegend | SMALegend | EMALegend | MarketBiasLegend | FibonacciLegend | FibExtLegend | VWAPLegend | undefined
): number | undefined => {
    if (!legend) return undefined;

    switch (type) {
        case 'volume':
            return (legend as VolumeLegend).volume;
        case 'sma':
        case 'ema':
            return (legend as SMALegend).value;
        case 'market-bias':
            return (legend as MarketBiasLegend).close;
        case 'fibonacci':
            return (legend as FibonacciLegend).value;
        case 'fibonacci-ext':
            return (legend as FibExtLegend).value;
        case 'vwap':
            return (legend as VWAPLegend).value;
        default:
            return undefined;
    }
}

const isPriceOverlay = (type: string) => type === 'sma' || type === 'ema' || type === 'market-bias' || type === 'fibonacci' || type === 'fibonacci-ext' || type === 'vwap';

type OverlayLegendItemProps = {
    overlay: OverlayIndicator;
    overlayLegend: VolumeLegend | SMALegend | EMALegend | MarketBiasLegend | FibonacciLegend | FibExtLegend | VWAPLegend | undefined;
    color: string;
}

function OverlayLegendItem({ overlay, overlayLegend, color }: OverlayLegendItemProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const cogRef = useRef<HTMLButtonElement>(null);
    
    // Use context directly - no prop drilling
    const { toggleOverlay, removeOverlay, updateOverlayConfig } = useOverlays();
    
    const value = getOverlayValueFromLegend(overlay.type, overlayLegend);
    const volumeTabs = useMemo(() => {
        if (overlay.type !== 'volume') return [];
        return buildMetaTabs(
            VolumeMeta,
            overlay.config as VolumeConfig,
            (updates) => updateOverlayConfig(overlay.id, updates)
        );
    }, [overlay.id, overlay.type, overlay.config, updateOverlayConfig]);

    const maTabs = useMemo(() => {
        if (overlay.type !== 'sma' && overlay.type !== 'ema') return [];
        return buildMetaTabs(
            MAMeta,
            overlay.config as MAConfig,
            (updates) => updateOverlayConfig(overlay.id, updates)
        );
    }, [overlay.id, overlay.type, overlay.config, updateOverlayConfig]);

    const marketBiasTabs = useMemo(() => {
        if (overlay.type !== 'market-bias') return [];
        return buildMetaTabs(
            MarketBiasMeta,
            overlay.config as MarketBiasConfig,
            (updates) => updateOverlayConfig(overlay.id, updates)
        );
    }, [overlay.id, overlay.type, overlay.config, updateOverlayConfig]);

    const fibonacciTabs = useMemo(() => {
        if (overlay.type !== 'fibonacci') return [];
        return buildMetaTabs(
            FibonacciMeta,
            overlay.config as FibonacciConfig,
            (updates) => updateOverlayConfig(overlay.id, updates)
        );
    }, [overlay.id, overlay.type, overlay.config, updateOverlayConfig]);

    const fibExtTabs = useMemo(() => {
        if (overlay.type !== 'fibonacci-ext') return [];
        return buildMetaTabs(
            FibExtMeta,
            overlay.config as FibExtConfig,
            (updates) => updateOverlayConfig(overlay.id, updates)
        );
    }, [overlay.id, overlay.type, overlay.config, updateOverlayConfig]);

    const vwapTabs = useMemo(() => {
        if (overlay.type !== 'vwap') return [];
        return buildMetaTabs(
            VWAPMeta,
            overlay.config as VWAPConfig,
            (updates) => updateOverlayConfig(overlay.id, updates)
        );
    }, [overlay.id, overlay.type, overlay.config, updateOverlayConfig]);

    return (
        <div 
            un-flex="~ items-center gap-1" 
            un-opacity={overlay.visible ? '100' : '50'}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <span un-text="slate-500">{getOverlayLabel(overlay)}</span>
            {value !== undefined && overlay.visible && (
                <span un-text={color}>
                    {isPriceOverlay(overlay.type) ? formatPrice(value) : formatVol(value)}
                </span>
            )}
            {isHovered && (
                <>
                    <button
                        ref={cogRef}
                        onClick={() => setConfigOpen(p => !p)}
                        un-cursor="pointer"
                        un-p="0.5"
                        un-hover:bg="slate-100"
                        un-border="rounded"
                        un-text="slate-400 hover:slate-600"
                    >
                        <Settings size={12} />
                    </button>
                    <button
                        onClick={() => toggleOverlay(overlay.id)}
                        un-cursor="pointer"
                        un-p="0.5"
                        un-hover:bg="slate-100"
                        un-border="rounded"
                        un-text="slate-400 hover:slate-600"
                    >
                        {overlay.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                        onClick={() => removeOverlay(overlay.id)}
                        un-cursor="pointer"
                        un-p="0.5"
                        un-hover:bg="red-100"
                        un-border="rounded"
                        un-text="slate-400 hover:red-500"
                    >
                        <X size={12} />
                    </button>
                </>
            )}
            
            {/* Config popup based on overlay type */}
            {overlay.type === 'volume' && (
                <ChartConfigPopup
                    title="Volume Settings"
                    isOpen={configOpen}
                    onClose={() => setConfigOpen(false)}
                    triggerRef={cogRef}
                    tabs={volumeTabs}
                />
            )}
            {(overlay.type === 'sma' || overlay.type === 'ema') && (
                <ChartConfigPopup
                    title={overlay.type === 'sma' ? 'SMA Settings' : 'EMA Settings'}
                    isOpen={configOpen}
                    onClose={() => setConfigOpen(false)}
                    triggerRef={cogRef}
                    tabs={maTabs}
                />
            )}
            {overlay.type === 'market-bias' && (
                <ChartConfigPopup
                    title="Market Bias Settings"
                    isOpen={configOpen}
                    onClose={() => setConfigOpen(false)}
                    triggerRef={cogRef}
                    tabs={marketBiasTabs}
                />
            )}
            {overlay.type === 'fibonacci' && (
                <ChartConfigPopup
                    title="Fibonacci Settings"
                    isOpen={configOpen}
                    onClose={() => setConfigOpen(false)}
                    triggerRef={cogRef}
                    tabs={fibonacciTabs}
                />
            )}
            {overlay.type === 'fibonacci-ext' && (
                <ChartConfigPopup
                    title="Fibonacci Extension Settings"
                    isOpen={configOpen}
                    onClose={() => setConfigOpen(false)}
                    triggerRef={cogRef}
                    tabs={fibExtTabs}
                />
            )}
            {overlay.type === 'vwap' && (
                <ChartConfigPopup
                    title="VWAP Settings"
                    isOpen={configOpen}
                    onClose={() => setConfigOpen(false)}
                    triggerRef={cogRef}
                    tabs={vwapTabs}
                />
            )}
        </div>
    )
}

export function ChartLegend() {
    const { mainLegend: legend, overlayLegends } = useLegend();
    const { overlays: overlaysRecord } = useOverlays();
    const overlays = useMemo(() => Object.values(overlaysRecord), [overlaysRecord]);
    
    if (!legend && overlays.length === 0) return null;

    const color = legend ? getColor(legend) : '#26a69a'
    
    return (
        <>
            {legend && (
                <div
                    un-position="absolute top-1 left-2" 
                    un-z="10" 
                    un-text="xs" 
                    un-font="mono"
                    un-bg='white' 
                    un-shadow='sm' 
                    un-border='rounded' 
                    un-p='1'
                    un-pointer-events="none"
                >
                    <div un-flex="~ wrap gap-2">
                        <div un-flex="~ gap-1">
                            <span un-text="slate-500">O</span>
                            <span un-text={color}>{formatPrice(legend.open)}</span>
                        </div>
                        <div un-flex="~ gap-1">
                            <span un-text="slate-500">H</span>
                            <span un-text={color}>{formatPrice(legend.high)}</span>
                        </div>
                        <div un-flex="~ gap-1">
                            <span un-text="slate-500">L</span>
                            <span un-text={color}>{formatPrice(legend.low)}</span>
                        </div>
                        <div un-flex="~ gap-1">
                            <span un-text="slate-500">C</span>
                            <span un-text={color}>{formatPrice(legend.close)}</span>
                        </div>
                        <div un-flex="~ gap-1">
                            <span un-text={legend.close >= legend.open ? 'green-500' : 'red-500'}>
                                {legend.close >= legend.open ? '↑' : '↓'} {(legend.close - legend.open).toFixed(2)} ({((legend.close - legend.open) / legend.open * 100).toFixed(2)}%)
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {overlays.length > 0 && (
                <div 
                    un-position="absolute left-2 top-8" 
                    un-z="10" 
                    un-text="xs" 
                    un-font="mono"
                    un-bg='white' 
                    un-shadow='sm' 
                    un-border='rounded' 
                    un-p='1'
                    un-pointer-events="auto"
                >
                    <div un-flex="~ col gap-1">
                        {overlays.map(overlay => (
                            <OverlayLegendItem
                                key={overlay.id}
                                overlay={overlay}
                                overlayLegend={overlayLegends[overlay.id]}
                                color={color}
                            />
                        ))}
                    </div>
                </div>
            )}
        </>
    )
}
