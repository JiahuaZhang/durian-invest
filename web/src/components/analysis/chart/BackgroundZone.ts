import { CanvasRenderingTarget2D } from 'fancy-canvas'
import type {
    Coordinate,
    IChartApi,
    ISeriesApi,
    ISeriesPrimitive,
    SeriesOptionsMap,
    SeriesType,
    Time,
} from 'lightweight-charts'

export interface BackgroundZoneOptions {
    color: string
}

class BackgroundZonePaneRenderer {
    _xStart: Coordinate | null = null
    _xEnd: Coordinate | null = null
    _options: BackgroundZoneOptions

    constructor(xStart: Coordinate | null, xEnd: Coordinate | null, options: BackgroundZoneOptions) {
        this._xStart = xStart
        this._xEnd = xEnd
        this._options = options
    }

    draw(target: CanvasRenderingTarget2D) {
        target.useBitmapCoordinateSpace(scope => {
            if (this._xStart === null || this._xEnd === null) return
            const ctx = scope.context

            const x1 = Math.round(scope.horizontalPixelRatio * this._xStart)
            const x2 = Math.round(scope.horizontalPixelRatio * this._xEnd)
            const left = Math.min(x1, x2)
            const width = Math.abs(x2 - x1)

            ctx.fillStyle = this._options.color
            ctx.fillRect(left, 0, width, scope.bitmapSize.height)
        })
    }
}

class BackgroundZonePaneView {
    _source: BackgroundZone
    _xStart: Coordinate | null = null
    _xEnd: Coordinate | null = null
    _options: BackgroundZoneOptions

    constructor(source: BackgroundZone, options: BackgroundZoneOptions) {
        this._source = source
        this._options = options
    }

    update() {
        const timeScale = this._source._chart.timeScale()
        this._xStart = timeScale.timeToCoordinate(this._source._timeStart)
        this._xEnd = timeScale.timeToCoordinate(this._source._timeEnd)
    }

    renderer() {
        return new BackgroundZonePaneRenderer(this._xStart, this._xEnd, this._options)
    }
}

export class BackgroundZone implements ISeriesPrimitive<Time> {
    _chart: IChartApi
    _series: ISeriesApi<keyof SeriesOptionsMap>
    _timeStart: Time
    _timeEnd: Time
    _paneViews: BackgroundZonePaneView[]

    constructor(
        chart: IChartApi,
        series: ISeriesApi<SeriesType>,
        timeStart: Time,
        timeEnd: Time,
        options: BackgroundZoneOptions,
    ) {
        this._chart = chart
        this._series = series
        this._timeStart = timeStart
        this._timeEnd = timeEnd
        this._paneViews = [new BackgroundZonePaneView(this, options)]
    }

    updateAllViews() {
        this._paneViews.forEach(pw => pw.update())
    }

    paneViews() {
        return this._paneViews as any
    }
}
