import { CandleData } from '@/components/analysis/context/ChartDataContext';
import { createServerFn } from '@tanstack/react-start';

export type YahooQuote = {
    high: number[]
    open: number[]
    low: number[]
    close: number[]
    volume: number[]
}

export type YahooIndicators = {
    quote: YahooQuote[]
    adjclose: { adjclose: number[] }[]
}

export type YahooResult = {
    meta: {
        currency: string
        symbol: string
        exchangeName: string
        instrumentType: string
        firstTradeDate: number
        regularMarketTime: number
        gmtoffset: number
        timezone: string
        exchangeTimezoneName: string
        regularMarketPrice: number
        chartPreviousClose: number
        priceHint: number
        dataGranularity: string
        range: string
        validRanges: string[]
    }
    timestamp: number[]
    indicators: YahooIndicators
}

export type YahooChart = {
    result: YahooResult[]
    error: any
}

export type YahooResponse = {
    chart: YahooChart
}

export function fromYahooData(json: YahooResponse): CandleData[] {
    if (!json.chart || !json.chart.result || json.chart.result.length === 0) {
        throw new Error("No data found");
    }

    const result = json.chart.result[0];
    const quote = result.indicators.quote[0];
    const timestamps = result.timestamp;

    if (!timestamps || !quote || !quote.open) {
        throw new Error("Incomplete data");
    }

    const adjustCloses = result.indicators.adjclose[0].adjclose;

    return timestamps.map((ts, index) => {
        const date = new Date(ts * 1000);
        const dayStr = date.toISOString().split('T')[0];
        const open = quote.open[index];
        const high = quote.high[index];
        const low = quote.low[index];
        const close = quote.close[index];
        const volume = quote.volume[index];
        const adjustClose = adjustCloses[index];

        return {
            time: dayStr,
            open,
            high,
            low,
            close,
            volume,
            adjustClose,
        }
    }).filter(c => c.open != null && c.high != null && c.low != null && c.close != null)
        .sort((a, b) => a.time.localeCompare(b.time))
        .filter((item, index, self) => index === 0 || item.time !== self[index - 1].time);

}

export const fetchYahooData = createServerFn({ method: "GET" })
    .inputValidator((d: { symbol: string, interval: string, range: string }) => d)
    .handler(async (ctx: { data: { symbol: string, interval: string, range: string } }) => {
        const { symbol, interval, range } = ctx.data;
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch data: ${response.statusText}`);
        }
        const json = await response.json();
        return fromYahooData(json);
    });
