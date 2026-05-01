// ── Binance BTCUSDT real-time data types & state ─────────────────────────

// ── Raw stream types ─────────────────────────────────────────────────────

/** Server-aggregated 1-second trade bucket (from btcusdt@aggTrade via relay) */
export type AggTradeBucket = {
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;        // BTC traded
    buyVolume: number;     // buyer-initiated BTC
    sellVolume: number;    // seller-initiated BTC
    quoteVolume: number;   // USDT traded
    buyQuoteVolume: number;
    tradeCount: number;
};

/** Top-20 partial order book snapshot (from btcusdt@depth20@100ms) */
export type DepthSnapshot = {
    ts: number;
    lastUpdateId: number;
    bids: [number, number][];  // [price, qty][] sorted desc
    asks: [number, number][];  // [price, qty][] sorted asc
};

/** Best bid/ask ticker (from btcusdt@bookTicker) */
export type BookTicker = {
    ts: number;
    updateId: number;
    bestBid: number;
    bestBidQty: number;
    bestAsk: number;
    bestAskQty: number;
    mid: number;
    spread: number;
};

/** 1-second or 1-minute kline */
export type Kline = {
    ts: number;             // kline start time
    closeTime: number;      // kline close time
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;         // base asset volume (BTC)
    quoteVolume: number;    // quote asset volume (USDT)
    takerBuyVolume: number; // taker buy base volume
    takerBuyQuoteVolume: number;
    trades: number;
    isClosed: boolean;
};

// ── Cost-to-break ────────────────────────────────────────────────────────

export type CostToBreak = {
    priceTarget: number;
    direction: 'up' | 'down';
    costUsdt: number;       // total USDT needed to sweep to that level
    depthBtc: number;       // total BTC that would be absorbed
    levels: number;         // number of order book levels to sweep through
};

/** Cost to move the price from current level to the Kalshi floor_strike */
export type CostToStrike = {
    strike: number;
    currentMid: number;
    distanceToStrike: number;  // positive = above strike, negative = below
    /** Cost (USDT) to push price DOWN to strike (sweep bids). 0 if already below. */
    costDown: number;
    depthBtcDown: number;
    levelsDown: number;
    /** Cost (USDT) to push price UP to strike (sweep asks). 0 if already above. */
    costUp: number;
    depthBtcUp: number;
    levelsUp: number;
};

/**
 * Compute cost to move the price to various targets by sweeping through the order book.
 * When strikePrice is given, offsets are relative to the strike.
 * Otherwise offsets are relative to the current midprice.
 */
export function computeCostToBreak(
    depth: DepthSnapshot,
    targets: number[],  // e.g. [50, 100, 200, 500]
    strikePrice?: number,
): CostToBreak[] {
    if (!depth || depth.asks.length === 0 || depth.bids.length === 0) return [];

    const anchor = strikePrice ?? (depth.bids[0][0] + depth.asks[0][0]) / 2;
    const results: CostToBreak[] = [];

    // Sweep asks (price UP from anchor)
    for (const offset of targets) {
        const target = anchor + offset;
        let costUsdt = 0, depthBtc = 0, levels = 0;
        for (const [price, qty] of depth.asks) {
            if (price > target) break;
            costUsdt += price * qty;
            depthBtc += qty;
            levels++;
        }
        results.push({ priceTarget: target, direction: 'up', costUsdt, depthBtc, levels });
    }

    // Sweep bids (price DOWN from anchor)
    for (const offset of targets) {
        const target = anchor - offset;
        let costUsdt = 0, depthBtc = 0, levels = 0;
        for (const [price, qty] of depth.bids) {
            if (price < target) break;
            costUsdt += price * qty;
            depthBtc += qty;
            levels++;
        }
        results.push({ priceTarget: target, direction: 'down', costUsdt, depthBtc, levels });
    }

    return results;
}

/**
 * Compute the cost to push BTC price to the Kalshi floor_strike from the current orderbook.
 * This is the most meaningful metric — how much capital is needed to push price to/past settlement.
 */
export function computeCostToStrike(depth: DepthSnapshot, strike: number): CostToStrike | null {
    if (!depth || depth.asks.length === 0 || depth.bids.length === 0) return null;

    const mid = (depth.bids[0][0] + depth.asks[0][0]) / 2;
    const dist = mid - strike;

    // Cost to push price DOWN to strike: sweep bids from current to strike
    let costDown = 0, depthBtcDown = 0, levelsDown = 0;
    if (mid > strike) {
        for (const [price, qty] of depth.bids) {
            if (price < strike) break;
            costDown += price * qty;
            depthBtcDown += qty;
            levelsDown++;
        }
    }

    // Cost to push price UP to strike: sweep asks from current to strike
    let costUp = 0, depthBtcUp = 0, levelsUp = 0;
    if (mid < strike) {
        for (const [price, qty] of depth.asks) {
            if (price > strike) break;
            costUp += price * qty;
            depthBtcUp += qty;
            levelsUp++;
        }
    }

    return {
        strike, currentMid: mid, distanceToStrike: dist,
        costDown, depthBtcDown, levelsDown,
        costUp, depthBtcUp, levelsUp,
    };
}

// ── Trade flow metrics ───────────────────────────────────────────────────

export type TradeFlowMetrics = {
    /** (buyVol - sellVol) / totalVol over the window, range [-1, 1] */
    imbalance: number;
    totalVolume: number;
    buyVolume: number;
    sellVolume: number;
    vwap: number;
    tradesPerSec: number;
};

export function computeTradeFlow(
    buckets: AggTradeBucket[],
    windowMs: number,
    now: number,
): TradeFlowMetrics {
    const cutoff = now - windowMs;
    const window = buckets.filter(b => b.ts >= cutoff);

    if (window.length === 0) {
        return { imbalance: 0, totalVolume: 0, buyVolume: 0, sellVolume: 0, vwap: 0, tradesPerSec: 0 };
    }

    let totalVol = 0, buyVol = 0, sellVol = 0, quoteVol = 0, trades = 0;
    for (const b of window) {
        totalVol += b.volume;
        buyVol += b.buyVolume;
        sellVol += b.sellVolume;
        quoteVol += b.quoteVolume;
        trades += b.tradeCount;
    }

    const durationSec = Math.max((now - cutoff) / 1000, 1);

    return {
        imbalance: totalVol > 0 ? (buyVol - sellVol) / totalVol : 0,
        totalVolume: totalVol,
        buyVolume: buyVol,
        sellVolume: sellVol,
        vwap: totalVol > 0 ? quoteVol / totalVol : 0,
        tradesPerSec: trades / durationSec,
    };
}

// ── Depth imbalance ──────────────────────────────────────────────────────

export function depthImbalance(depth: DepthSnapshot): number {
    if (!depth) return 0;
    let bidVol = 0, askVol = 0;
    for (const [, qty] of depth.bids) bidVol += qty;
    for (const [, qty] of depth.asks) askVol += qty;
    const total = bidVol + askVol;
    return total > 0 ? (bidVol - askVol) / total : 0;
}

// ── Parse helpers (from Binance raw messages) ────────────────────────────

export function parseDepth(raw: any, ts: number): DepthSnapshot {
    return {
        ts,
        lastUpdateId: raw.lastUpdateId,
        bids: (raw.bids as [string, string][]).map(([p, q]) => [parseFloat(p), parseFloat(q)]),
        asks: (raw.asks as [string, string][]).map(([p, q]) => [parseFloat(p), parseFloat(q)]),
    };
}

export function parseBookTicker(raw: any, ts: number): BookTicker {
    const bid = parseFloat(raw.b);
    const ask = parseFloat(raw.a);
    return {
        ts,
        updateId: raw.u,
        bestBid: bid,
        bestBidQty: parseFloat(raw.B),
        bestAsk: ask,
        bestAskQty: parseFloat(raw.A),
        mid: (bid + ask) / 2,
        spread: ask - bid,
    };
}

export function parseKline(raw: any, ts: number): Kline {
    const k = raw.k;
    return {
        ts: k.t ?? ts,
        closeTime: k.T,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        quoteVolume: parseFloat(k.q),
        takerBuyVolume: parseFloat(k.V),
        takerBuyQuoteVolume: parseFloat(k.Q),
        trades: k.n,
        isClosed: k.x,
    };
}

// ── Aggregate state ──────────────────────────────────────────────────────

export type BinanceState = {
    connected: boolean;
    lastPrice: number;
    windowOpenPrice: number | null;  // BTC price at start of current 15-min window
    tradeBuckets: AggTradeBucket[];
    depth: DepthSnapshot | null;
    bookTicker: BookTicker | null;
};

export function emptyBinanceState(): BinanceState {
    return {
        connected: false,
        lastPrice: 0,
        windowOpenPrice: null,
        tradeBuckets: [],
        depth: null,
        bookTicker: null,
    };
}

// ── Combined recording types ─────────────────────────────────────────────

export type CombinedEvent =
    | { source: 'kalshi'; recvTs: number; seq?: number; type: 'snapshot' | 'delta'; data: any; }
    | { source: 'binance'; recvTs: number; type: 'aggTradeBucket'; data: AggTradeBucket; }
    | { source: 'binance'; recvTs: number; type: 'depth'; data: DepthSnapshot; }
    | { source: 'binance'; recvTs: number; type: 'bookTicker'; data: BookTicker; };

export type CombinedRecording = {
    id: string;
    kalshiTicker: string;
    startedAt: number;
    events: CombinedEvent[];
};

export function emptyCombinedRecording(): CombinedRecording {
    return { id: '', kalshiTicker: '', startedAt: 0, events: [] };
}

/** Format USDT amounts for display */
export function fmtUsd(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
}

/** Format BTC amounts for display */
export function fmtBtc(v: number): string {
    if (v >= 1) return `${v.toFixed(3)} BTC`;
    return `${(v * 1000).toFixed(1)} mBTC`;
}
