import {
    type BookState,
    applyDelta, applySnapshot, emptyBook
} from '@/utils/kalshi/orderbook';
import { getCurrent15mMarketTicker } from '@/utils/kalshi/ticker';
import { useEffect, useRef, useState } from 'react';
import {
    type AggTradeBucket, type BinanceState,
    type CombinedEvent,
    type CombinedRecording,
    computeCostToBreak, computeCostToStrike, computeTradeFlow, depthImbalance, emptyBinanceState,
    parseBookTicker, parseDepth, parseKline
} from './binance';
import { type MarketContext, fetchMarketContext } from './market-context';

const SERIES = 'KXBTC15M';
const KALSHI_WS = '/api/kalshi-ws';
const BINANCE_WS = '/api/binance-ws';
const COST_TARGETS = [50, 100, 200, 500];

type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export function useDashboard() {
    const [kalshiConn, setKalshiConn] = useState<ConnState>('idle');
    const [kalshiError, setKalshiError] = useState<string | null>(null);
    const [kalshiBook, setKalshiBook] = useState<BookState>(() => emptyBook());
    const [ticker, setTicker] = useState('');
    const [closeTs, setCloseTs] = useState(0);

    const [binanceConn, setBinanceConn] = useState<ConnState>('idle');
    const [binance, setBinance] = useState<BinanceState>(() => emptyBinanceState());

    const [marketCtx, setMarketCtx] = useState<MarketContext | null>(null);

    const [recording, setRecording] = useState<CombinedRecording | null>(null);
    const [previousRecording, setPreviousRecording] = useState<CombinedRecording | null>(null);
    const [isRecording, setIsRecording] = useState(true);
    const [mounted, setMounted] = useState(false);

    const kalshiWs = useRef<WebSocket | null>(null);
    const binanceWs = useRef<WebSocket | null>(null);
    const kalshiReconn = useRef<ReturnType<typeof setTimeout> | null>(null);
    const binanceReconn = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recRef = useRef(isRecording);
    const tickerRef = useRef(ticker);
    useEffect(() => { recRef.current = isRecording; }, [isRecording]);
    useEffect(() => { tickerRef.current = ticker; }, [ticker]);

    const appendEvent = (ev: CombinedEvent) => {
        if (!recRef.current) return;
        setRecording(prev => {
            if (!prev) return { id: 'rec_' + Date.now(), kalshiTicker: tickerRef.current, startedAt: ev.recvTs, events: [ev] };
            return { ...prev, events: [...prev.events, ev] };
        });
    };

    // ── Fetch market context (floor_strike + Binance open price) ─────
    const loadMarketContext = (t: string) => {
        if (!t) return;
        fetchMarketContext({ data: { ticker: t } }).then(ctx => {
            if (ctx) {
                setMarketCtx(ctx);
                // Use the Binance open price (at Kalshi open_time) as the windowOpenPrice
                if (ctx.binanceOpenPrice > 0) {
                    setBinance(prev => ({ ...prev, windowOpenPrice: ctx.binanceOpenPrice }));
                }
            }
        }).catch(err => console.error('[market-context] fetch failed:', err));
    };

    // ── Kalshi WS ────────────────────────────────────────────────
    const connectKalshi = () => {
        if (typeof window === 'undefined') return;
        kalshiWs.current?.close();
        const { ticker: t, closeTs: c } = getCurrent15mMarketTicker(SERIES);
        setTicker(t); setCloseTs(c); setKalshiConn('connecting'); setKalshiError(null);

        // Load market context for the new ticker
        loadMarketContext(t);

        const url = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + KALSHI_WS;
        const ws = new WebSocket(url);
        kalshiWs.current = ws;
        let cmdId = 0;

        ws.onopen = () => {
            setKalshiConn('open');
            cmdId++;
            ws.send(JSON.stringify({ id: cmdId, cmd: 'subscribe', params: { channels: ['orderbook_delta'], market_ticker: t, send_initial_snapshot: true } }));
        };
        ws.onmessage = (ev) => {
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }
            const recvTs = Date.now();
            const seq = typeof msg?.seq === 'number' ? msg.seq : undefined;
            if (msg?.type === 'orderbook_snapshot' && msg.msg) {
                const snap = msg.msg;
                setKalshiBook(applySnapshot(snap, recvTs));
                appendEvent({ source: 'kalshi', recvTs, seq, type: 'snapshot', data: snap });
            } else if (msg?.type === 'orderbook_delta' && msg.msg) {
                const delta = msg.msg;
                setKalshiBook(prev => prev.market_ticker ? applyDelta(prev, delta, recvTs) : prev);
                appendEvent({ source: 'kalshi', recvTs, seq, type: 'delta', data: delta });
            } else if (msg?.type === 'error') {
                setKalshiError('Kalshi: ' + (msg?.msg?.msg ?? JSON.stringify(msg.msg)));
            }
        };
        ws.onerror = () => { setKalshiConn('error'); setKalshiError('Kalshi WS error'); };
        ws.onclose = (ev) => {
            setKalshiConn('closed');
            if (ev.code && ev.code !== 1000 && ev.code !== 1005) setKalshiError('Kalshi closed (' + ev.code + ')');
            kalshiReconn.current = setTimeout(connectKalshi, 5000);
        };
    };

    // ── Binance WS ───────────────────────────────────────────────
    const connectBinance = () => {
        if (typeof window === 'undefined') return;
        binanceWs.current?.close();
        setBinanceConn('connecting');

        const url = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + BINANCE_WS;
        const ws = new WebSocket(url);
        binanceWs.current = ws;

        ws.onopen = () => setBinanceConn('open');
        ws.onmessage = (ev) => {
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }
            const recvTs = Date.now();
            const stream = msg.stream as string;

            if (stream === 'btcusdt@aggTradeBucket') {
                const bucket = msg.data as AggTradeBucket;
                setBinance(prev => ({
                    ...prev,
                    lastPrice: bucket.close,
                    // windowOpenPrice is set by market context, don't overwrite
                    windowOpenPrice: prev.windowOpenPrice ?? bucket.close,
                    tradeBuckets: [...prev.tradeBuckets.slice(-900), bucket],
                }));
                appendEvent({ source: 'binance', recvTs, type: 'aggTradeBucket', data: bucket });
            } else if (stream === 'btcusdt@depth20@100ms') {
                const depth = parseDepth(msg.data, recvTs);
                setBinance(prev => ({ ...prev, depth, lastPrice: prev.lastPrice || depth.bids[0]?.[0] || 0 }));
                appendEvent({ source: 'binance', recvTs, type: 'depth', data: depth });
            } else if (stream === 'btcusdt@bookTicker') {
                const bt = parseBookTicker(msg.data, recvTs);
                setBinance(prev => ({ ...prev, bookTicker: bt, lastPrice: bt.mid }));
                appendEvent({ source: 'binance', recvTs, type: 'bookTicker', data: bt });
            }
        };
        ws.onerror = () => setBinanceConn('error');
        ws.onclose = () => {
            setBinanceConn('closed');
            binanceReconn.current = setTimeout(connectBinance, 3000);
        };
    };

    // ── Lifecycle ────────────────────────────────────────────────
    useEffect(() => {
        setMounted(true);
        const { ticker: t, closeTs: c } = getCurrent15mMarketTicker(SERIES);
        setTicker(t); setCloseTs(c);
    }, []);

    useEffect(() => {
        if (!mounted) return;
        connectKalshi();
        connectBinance();
        return () => {
            [kalshiReconn, binanceReconn].forEach(r => { if (r.current) clearTimeout(r.current); });
            kalshiWs.current?.close(); binanceWs.current?.close();
        };
    }, [mounted]);

    // Rotate ticker at 15-min boundary
    useEffect(() => {
        if (!mounted || closeTs === 0) return;
        const msLeft = Math.max(closeTs * 1000 - Date.now(), 0) + 1500;
        const t = setTimeout(() => {
            // Save current recording as previous
            setRecording(prev => { setPreviousRecording(prev); return null; });
            setBinance(emptyBinanceState());
            setMarketCtx(null);
            connectKalshi();
        }, msLeft);
        return () => clearTimeout(t);
    }, [closeTs, mounted]);

    // ── Derived (computed every render, cheap enough) ─────────
    const floorStrike = marketCtx?.floorStrike ?? null;
    const now = Date.now();
    // Use floor_strike as anchor for cost-to-break when available
    const costToBreak = binance.depth
        ? computeCostToBreak(binance.depth, COST_TARGETS, floorStrike ?? undefined)
        : [];
    const costToStrike = binance.depth && floorStrike
        ? computeCostToStrike(binance.depth, floorStrike)
        : null;
    const tradeFlow30s = computeTradeFlow(binance.tradeBuckets, 30_000, now);
    const tradeFlow60s = computeTradeFlow(binance.tradeBuckets, 60_000, now);
    const depthImb = binance.depth ? depthImbalance(binance.depth) : 0;

    return {
        kalshiConn, kalshiError, kalshiBook, ticker, closeTs,
        binanceConn, binance,
        marketCtx, floorStrike,
        costToBreak, costToStrike, tradeFlow30s, tradeFlow60s, depthImb,
        recording, previousRecording, isRecording,
        setIsRecording, setRecording, setPreviousRecording,
    };
}

export function useCountdown(unixTs: number): string {
    const [now, setNow] = useState(0);
    useEffect(() => {
        setNow(Date.now());
        const i = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(i);
    }, []);
    if (now === 0 || unixTs === 0) return '--:--';
    const s = Math.max(Math.floor(unixTs - now / 1000), 0);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
