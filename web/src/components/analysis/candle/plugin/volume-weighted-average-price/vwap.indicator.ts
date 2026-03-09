/**
 * VWAP (Volume Weighted Average Price) Indicator — Chart series lifecycle.
 *
 * Manages lightweight-charts series for the VWAP overlay:
 *   - Primary: anchored AVWAP line (horizontal)
 *   - Extras:  [histogram bins, value-area zone?, POC line, VAH line, VAL line]
 */
import {
    BaselineSeries,
    LineSeries,
    LineStyle,
    type createChart,
    type IPrimitivePaneRenderer,
    type IPrimitivePaneView,
    type ISeriesApi,
    type ISeriesPrimitive,
    type SeriesAttachedParameter,
    type Time,
} from 'lightweight-charts';
import type { CandleData } from '../../../context/ChartContext';
import {
    computeVWAPData,
    type VWAPConfig,
    type VWAPRenderData,
} from './vwap';

// ============================================================================
// Types
// ============================================================================

type Chart = ReturnType<typeof createChart>;
type VolumeLabelData = {
    time: Time;
    price: number;
    label: string;
};

export type VWAPSeriesEntry = {
    primary: ISeriesApi<any>;
    extras: ISeriesApi<any>[];
    vwapMeta?: { numHistogramBins: number; hasValueAreaZone: boolean };
    volumeLabelPrimitive?: VWAPVolumeLabelsPrimitive;
    volumeLabelData?: VolumeLabelData[];
};

// ============================================================================
// Helpers
// ============================================================================

function addAlpha(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${1 - alpha / 255})`;
}

function shouldShowVolumeLabels(config: VWAPConfig, visible: boolean): boolean {
    return visible && config.showHistogram !== false && config.showVolumeLabels !== false;
}

function buildVolumeLabelData(render: VWAPRenderData): VolumeLabelData[] {
    return render.volumeLabels.map(label => ({
        time: label.time,
        price: label.price,
        label: label.label,
    }));
}

const VOLUME_LABEL_FONT = '700 11px monospace';
const VOLUME_LABEL_X_OFFSET = 4;

class VWAPVolumeLabelsRenderer implements IPrimitivePaneRenderer {
    private readonly primitive: VWAPVolumeLabelsPrimitive;

    constructor(primitive: VWAPVolumeLabelsPrimitive) {
        this.primitive = primitive;
    }

    draw(target: any): void {
        this.primitive.draw(target);
    }
}

class VWAPVolumeLabelsPaneView implements IPrimitivePaneView {
    private readonly primitive: VWAPVolumeLabelsPrimitive;
    private readonly paneRenderer: VWAPVolumeLabelsRenderer;

    constructor(primitive: VWAPVolumeLabelsPrimitive) {
        this.primitive = primitive;
        this.paneRenderer = new VWAPVolumeLabelsRenderer(primitive);
    }

    zOrder(): 'top' {
        return 'top';
    }

    renderer(): IPrimitivePaneRenderer | null {
        return this.primitive.shouldRender() ? this.paneRenderer : null;
    }
}

class VWAPVolumeLabelsPrimitive implements ISeriesPrimitive<Time> {
    private params?: SeriesAttachedParameter<Time>;
    private labels: VolumeLabelData[] = [];
    private color = '#000000';
    private visible = false;
    private readonly paneView = new VWAPVolumeLabelsPaneView(this);

    attached(param: SeriesAttachedParameter<Time>): void {
        this.params = param;
    }

    detached(): void {
        this.params = undefined;
    }

    paneViews(): readonly IPrimitivePaneView[] {
        return [this.paneView];
    }

    update(labels: VolumeLabelData[], color: string, visible: boolean): void {
        this.labels = labels;
        this.color = color;
        this.visible = visible;
        this.params?.requestUpdate();
    }

    shouldRender(): boolean {
        return this.visible && this.labels.length > 0 && this.params != null;
    }

    draw(target: any): void {
        const params = this.params;
        if (!params || !this.shouldRender()) return;

        const timeScale = params.chart.timeScale();
        const series = params.series;

        target.useMediaCoordinateSpace(({ context }: { context: CanvasRenderingContext2D; }) => {
            context.save();
            context.fillStyle = this.color;
            context.font = VOLUME_LABEL_FONT;
            context.textAlign = 'left';
            context.textBaseline = 'middle';

            for (const label of this.labels) {
                const x = timeScale.timeToCoordinate(label.time);
                const y = series.priceToCoordinate(label.price);
                if (x == null || y == null) continue;
                context.fillText(label.label, x + VOLUME_LABEL_X_OFFSET, y);
            }

            context.restore();
        });
    }
}

function createExtras(
    chart: Chart,
    render: VWAPRenderData,
    config: VWAPConfig,
    visible: boolean,
): ISeriesApi<any>[] {
    const extras: ISeriesApi<any>[] = [];

    // Volume profile histogram (one BaselineSeries per bin)
    const showHistogram = config.showHistogram !== false;
    const blockOpacity = Math.max(0, Math.min(100, config.blockFillOpacity ?? 70));
    const alpha = Math.round(255 * (100 - blockOpacity) / 100);
    const fillColor = addAlpha(config.blockFillColor ?? '#B0B0B0', alpha);
    for (const bin of render.histogramBins) {
        if (bin.volume <= 0) continue;
        const series = chart.addSeries(BaselineSeries, {
            baseValue: { type: 'price' as const, price: bin.binLow },
            topFillColor1: fillColor,
            topFillColor2: fillColor,
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
        series.setData(bin.data as any);
        series.applyOptions({ visible: visible && showHistogram });
        extras.push(series);
    }

    // Value Area zone band (BaselineSeries)
    if (render.valueAreaBand) {
        const series = chart.addSeries(BaselineSeries, {
            baseValue: { type: 'price' as const, price: render.valueAreaBand.bottomPrice },
            topFillColor1: config.valueAreaBgColor,
            topFillColor2: config.valueAreaBgColor,
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
        series.setData(render.valueAreaBand.data as any);
        series.applyOptions({ visible: visible && config.showValueAreaZone });
        extras.push(series);
    }

    // POC line
    const pocWidth = Math.min(4, Math.max(1, Math.round(config.pocWidth))) as 1 | 2 | 3 | 4;
    const pocSeries = chart.addSeries(LineSeries, {
        color: config.pocColor,
        lineWidth: pocWidth,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });
    pocSeries.setData(render.pocLine as any);
    pocSeries.applyOptions({ visible: visible && config.showPOC });
    extras.push(pocSeries);

    // VAH line (solid, like TradingView)
    const vaWidth = Math.min(4, Math.max(1, Math.round(config.vaWidth))) as 1 | 2 | 3 | 4;
    const vahSeries = chart.addSeries(LineSeries, {
        color: config.vaColor,
        lineWidth: vaWidth,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });
    vahSeries.setData(render.vahLine as any);
    vahSeries.applyOptions({ visible: visible && config.showVA });
    extras.push(vahSeries);

    // VAL line (solid, like TradingView)
    const valSeries = chart.addSeries(LineSeries, {
        color: config.vaColor,
        lineWidth: vaWidth,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });
    valSeries.setData(render.valLine as any);
    valSeries.applyOptions({ visible: visible && config.showVA });
    extras.push(valSeries);

    return extras;
}

// ============================================================================
// Public API
// ============================================================================

function add(
    chart: Chart,
    candleData: CandleData[],
    config: VWAPConfig,
    visible = true,
): { entry: VWAPSeriesEntry; data: any } {
    const computed = computeVWAPData(candleData, config);

    // Primary: anchored AVWAP line (horizontal, like TradingView)
    const vwapWidth = Math.min(4, Math.max(1, Math.round(config.vwapWidth))) as 1 | 2 | 3 | 4;
    const vwapSeries = chart.addSeries(LineSeries, {
        color: config.vwapColor,
        lineWidth: vwapWidth,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });
    vwapSeries.setData(computed.vwapLine as any);
    vwapSeries.applyOptions({ visible: visible && config.showVWAP });
    const volumeLabelData = buildVolumeLabelData(computed);
    const volumeLabelPrimitive = new VWAPVolumeLabelsPrimitive();
    vwapSeries.attachPrimitive(volumeLabelPrimitive);
    volumeLabelPrimitive.update(
        volumeLabelData,
        config.volumeLabelColor ?? '#000000',
        shouldShowVolumeLabels(config, visible),
    );

    const extras = createExtras(chart, computed, config, visible);
    const numHistogramBins = computed.histogramBins.filter(b => b.volume > 0).length;
    const hasValueAreaZone = computed.valueAreaBand != null;

    return {
        entry: {
            primary: vwapSeries,
            extras,
            vwapMeta: { numHistogramBins, hasValueAreaZone },
            volumeLabelPrimitive,
            volumeLabelData,
        },
        data: {
            pocPrice: computed.pocPrice,
            vahPrice: computed.vahPrice,
            valPrice: computed.valPrice,
            volumeLabels: computed.volumeLabels,
        },
    };
}

function update(
    chart: Chart,
    entry: VWAPSeriesEntry,
    candleData: CandleData[],
    config: VWAPConfig,
    visible: boolean,
): any {
    const computed = computeVWAPData(candleData, config);

    // Update primary anchored AVWAP line
    const vwapWidth = Math.min(4, Math.max(1, Math.round(config.vwapWidth))) as 1 | 2 | 3 | 4;
    entry.primary.setData(computed.vwapLine as any);
    entry.primary.applyOptions({
        color: config.vwapColor,
        lineWidth: vwapWidth,
        visible: visible && config.showVWAP,
    });

    // Remove old extras and recreate
    for (const s of entry.extras) {
        try { chart.removeSeries(s); } catch { /* already removed */ }
    }
    entry.extras = createExtras(chart, computed, config, visible);
    entry.vwapMeta = {
        numHistogramBins: computed.histogramBins.filter(b => b.volume > 0).length,
        hasValueAreaZone: computed.valueAreaBand != null,
    };
    const volumeLabelData = buildVolumeLabelData(computed);
    if (!entry.volumeLabelPrimitive) {
        entry.volumeLabelPrimitive = new VWAPVolumeLabelsPrimitive();
        entry.primary.attachPrimitive(entry.volumeLabelPrimitive);
    }
    entry.volumeLabelData = volumeLabelData;
    entry.volumeLabelPrimitive.update(
        volumeLabelData,
        config.volumeLabelColor ?? '#000000',
        shouldShowVolumeLabels(config, visible),
    );

    return {
        pocPrice: computed.pocPrice,
        vahPrice: computed.vahPrice,
        valPrice: computed.valPrice,
        volumeLabels: computed.volumeLabels,
    };
}

function toggle(
    entry: VWAPSeriesEntry,
    config: VWAPConfig,
    visible: boolean,
): void {
    entry.primary.applyOptions({ visible: visible && config.showVWAP });
    entry.volumeLabelPrimitive?.update(
        entry.volumeLabelData ?? [],
        config.volumeLabelColor ?? '#000000',
        shouldShowVolumeLabels(config, visible),
    );

    const meta = entry.vwapMeta ?? { numHistogramBins: 0, hasValueAreaZone: false };
    const showHistogram = config.showHistogram !== false;
    let idx = 0;

    // Histogram bins
    for (let i = 0; i < meta.numHistogramBins; i++) {
        entry.extras[idx]?.applyOptions({ visible: visible && showHistogram });
        idx++;
    }

    // Value area zone
    if (meta.hasValueAreaZone) {
        entry.extras[idx]?.applyOptions({ visible: visible && config.showValueAreaZone });
        idx++;
    }

    // POC
    entry.extras[idx]?.applyOptions({ visible: visible && config.showPOC });
    idx++;

    // VAH
    entry.extras[idx]?.applyOptions({ visible: visible && config.showVA });
    idx++;

    // VAL
    entry.extras[idx]?.applyOptions({ visible: visible && config.showVA });
}

function remove(chart: Chart, entry: VWAPSeriesEntry): void {
    if (entry.volumeLabelPrimitive) {
        try { entry.primary.detachPrimitive(entry.volumeLabelPrimitive); } catch { /* already removed */ }
        entry.volumeLabelPrimitive = undefined;
        entry.volumeLabelData = undefined;
    }
    for (const series of [entry.primary, ...entry.extras]) {
        try { chart.removeSeries(series); } catch { /* already removed */ }
    }
}

export const vwapIndicator = { add, update, toggle, remove };
