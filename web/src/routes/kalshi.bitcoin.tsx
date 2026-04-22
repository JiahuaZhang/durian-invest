import {
    applyDelta,
    applySnapshot,
    bestBid,
    BookState,
    cumulativeDepth,
    emptyBook,
    impliedYesAsksFromNo,
    Level,
    rebuildAt,
    RecordedEvent,
    Recording,
    sortedLevels,
    totalSize,
} from '@/utils/kalshi/orderbook';
import { formatEt, getCurrent15mMarketTicker } from '@/utils/kalshi/ticker';
import { createFileRoute } from '@tanstack/react-router';
import {
    ChevronsLeft,
    ChevronsRight,
    CircleDot,
    Download,
    FastForward,
    Pause,
    Play,
    Plug,
    PlugZap,
    Rewind,
    Square,
    Upload,
    Wifi,
    WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const Route = createFileRoute('/kalshi/bitcoin')({
    component: KalshiBitcoin,
});

const SERIES = 'KXBTC15M';
const WS_PATH = '/api/kalshi-ws';
const MAX_LEVELS_IN_LADDER = 16;
const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10, 25] as const;

type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
type Mode = 'live' | 'replay';

// ──────────────────────────────────────────────────────────────────────────

function KalshiBitcoin() {
    const [mode, setMode] = useState<Mode>('live');
    const [conn, setConn] = useState<ConnState>('idle');
    const [connError, setConnError] = useState<string | null>(null);

    // Time-based state is populated on mount to avoid SSR/CSR hydration mismatches.
    const [ticker, setTicker] = useState<string>('');
    const [closeTs, setCloseTs] = useState<number>(0);
    const [mounted, setMounted] = useState<boolean>(false);

    const [book, setBook] = useState<BookState>(() => emptyBook());

    // Live recording (always accumulates while connected)
    const [liveRecording, setLiveRecording] = useState<Recording | null>(null);
    const [recording, setRecording] = useState<boolean>(true);

    // Replay state
    const [loaded, setLoaded] = useState<Recording | null>(null);
    const [cursor, setCursor] = useState<number>(0);
    const [playing, setPlaying] = useState<boolean>(false);
    const [speed, setSpeed] = useState<(typeof REPLAY_SPEEDS)[number]>(1);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttempts = useRef<number>(0);
    const recordingRef = useRef<boolean>(recording);
    useEffect(() => {
        recordingRef.current = recording;
    }, [recording]);

    // ── Live WebSocket ───────────────────────────────────────────────────
    const connect = useCallback(() => {
        if (typeof window === 'undefined') return;
        if (wsRef.current) {
            try {
                wsRef.current.close();
            } catch { /* noop */ }
        }
        const { ticker: curTicker, closeTs: curClose } = getCurrent15mMarketTicker(SERIES);
        setTicker(curTicker);
        setCloseTs(curClose);
        setConn('connecting');
        setConnError(null);

        const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        let cmdId = 0;

        ws.onopen = () => {
            setConn('open');
            reconnectAttempts.current = 0;
            cmdId += 1;
            ws.send(
                JSON.stringify({
                    id: cmdId,
                    cmd: 'subscribe',
                    params: {
                        channels: ['orderbook_delta'],
                        market_ticker: curTicker,
                        send_initial_snapshot: true,
                    },
                }),
            );
        };

        ws.onmessage = (ev) => {
            let msg: any;
            try {
                msg = JSON.parse(ev.data);
            } catch {
                return;
            }
            const t = msg?.type;
            const recvTs = Date.now();
            const seq = typeof msg?.seq === 'number' ? msg.seq : undefined;

            if (t === 'orderbook_snapshot' && msg.msg) {
                const snap = msg.msg;
                const next = applySnapshot(snap, recvTs);
                setBook(next);
                if (recordingRef.current) {
                    setLiveRecording((rec) =>
                        appendEvent(rec, snap.market_ticker, snap.market_id, {
                            recvTs,
                            seq,
                            type: 'snapshot',
                            data: snap,
                        }),
                    );
                }
            } else if (t === 'orderbook_delta' && msg.msg) {
                const delta = msg.msg;
                setBook((prev) => (prev.market_ticker ? applyDelta(prev, delta, recvTs) : prev));
                if (recordingRef.current) {
                    setLiveRecording((rec) =>
                        appendEvent(rec, delta.market_ticker, delta.market_id, {
                            recvTs,
                            seq,
                            type: 'delta',
                            data: delta,
                        }),
                    );
                }
            } else if (t === 'error') {
                setConnError(`Kalshi: ${msg?.msg?.msg ?? JSON.stringify(msg.msg ?? msg)}`);
            }
            // Ignore 'subscribed' / 'ok' confirmations.
        };

        ws.onerror = () => {
            setConn('error');
            setConnError('WebSocket error — check the dev terminal for [kalshi-ws] logs');
        };

        ws.onclose = (ev) => {
            setConn('closed');
            if (ev.code && ev.code !== 1000 && ev.code !== 1005) {
                setConnError(`WebSocket closed (${ev.code} ${ev.reason || ''}) — see [kalshi-ws] logs`);
            }
            // Exponential backoff up to 30s. Gives you time to read the server log
            // and stops the log flood when credentials are wrong.
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            reconnectAttempts.current += 1;
            const delay = Math.min(2000 * 2 ** (reconnectAttempts.current - 1), 30000);
            reconnectTimer.current = setTimeout(() => {
                if (mode === 'live') connect();
            }, delay);
        };
    }, [mode]);

    useEffect(() => {
        setMounted(true);
        const { ticker: t, closeTs: c } = getCurrent15mMarketTicker(SERIES);
        setTicker(t);
        setCloseTs(c);
    }, []);

    useEffect(() => {
        if (!mounted) return;
        if (mode === 'live') connect();
        return () => {
            if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
                reconnectTimer.current = null;
            }
            const ws = wsRef.current;
            wsRef.current = null;
            if (ws) {
                try {
                    ws.close();
                } catch { /* noop */ }
            }
        };
    }, [mode, connect, mounted]);

    // Rotate ticker at market close boundary while live.
    useEffect(() => {
        if (!mounted || mode !== 'live' || closeTs === 0) return;
        const msLeft = Math.max(closeTs * 1000 - Date.now(), 0) + 1000;
        const t = setTimeout(() => connect(), msLeft);
        return () => clearTimeout(t);
    }, [closeTs, connect, mode, mounted]);

    // ── Replay engine ────────────────────────────────────────────────────
    useEffect(() => {
        if (mode !== 'replay' || !loaded || !playing) return;
        if (cursor >= loaded.events.length - 1) {
            setPlaying(false);
            return;
        }
        const cur = loaded.events[cursor];
        const nxt = loaded.events[cursor + 1];
        const rawGap = Math.max(nxt.recvTs - cur.recvTs, 0);
        const gap = Math.min(Math.max(rawGap / speed, 16), 1500);
        const id = setTimeout(() => setCursor((c) => c + 1), gap);
        return () => clearTimeout(id);
    }, [cursor, loaded, mode, playing, speed]);

    // Compute visible book.
    const visibleBook = useMemo(() => {
        if (mode === 'replay' && loaded) {
            return rebuildAt(loaded.events, cursor) ?? emptyBook();
        }
        return book;
    }, [mode, loaded, cursor, book]);

    // ── Derived metrics ──────────────────────────────────────────────────
    const metrics = useMemo(() => computeMetrics(visibleBook), [visibleBook]);

    // Currently-used recording for download / timeline view
    const currentRecording = mode === 'replay' ? loaded : liveRecording;

    const closeCountdown = useCountdown(closeTs);

    // ── Handlers ─────────────────────────────────────────────────────────
    const enterReplay = () => {
        setMode('replay');
        setPlaying(false);
        if (!loaded && liveRecording && liveRecording.events.length > 0) {
            setLoaded(liveRecording);
            setCursor(liveRecording.events.length - 1);
        }
    };

    const exitReplay = () => {
        setMode('live');
        setPlaying(false);
    };

    const onDownload = () => {
        const rec = currentRecording;
        if (!rec || rec.events.length === 0) return;
        const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${rec.market_ticker || 'kalshi'}_${new Date(rec.startedAt).toISOString().replace(/[:.]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const onUpload = async (file: File) => {
        const text = await file.text();
        try {
            const parsed = JSON.parse(text) as Recording;
            if (!Array.isArray(parsed.events)) throw new Error('Malformed recording');
            setLoaded(parsed);
            setMode('replay');
            setCursor(0);
            setPlaying(false);
        } catch (e) {
            alert(`Failed to load recording: ${(e as Error).message}`);
        }
    };

    const onClear = () => {
        if (mode === 'live') {
            setLiveRecording(null);
        } else {
            setLoaded(null);
            setCursor(0);
            setPlaying(false);
        }
    };

    // ── Render ───────────────────────────────────────────────────────────
    return (
        <div un-p="3" un-flex="~ col" un-gap="3" un-min-h="screen" un-bg="slate-50/40">
            <Header
                ticker={ticker}
                conn={conn}
                connError={connError}
                mode={mode}
                closeCountdown={closeCountdown}
                onModeLive={exitReplay}
                onModeReplay={enterReplay}
                onReconnect={connect}
            />

            <ReplayPanel
                mode={mode}
                recording={recording}
                onToggleRecording={() => setRecording((r) => !r)}
                onClear={onClear}
                onDownload={onDownload}
                onUpload={onUpload}
                liveRecording={liveRecording}
                loaded={loaded}
                cursor={cursor}
                setCursor={setCursor}
                playing={playing}
                setPlaying={setPlaying}
                speed={speed}
                setSpeed={setSpeed}
                onEnterReplay={enterReplay}
                onExitReplay={exitReplay}
                onUseLiveAsReplay={() => {
                    if (!liveRecording) return;
                    setLoaded(liveRecording);
                    setMode('replay');
                    setCursor(liveRecording.events.length - 1);
                    setPlaying(false);
                }}
            />

            <StatsStrip metrics={metrics} book={visibleBook} />

            <div un-grid="~ cols-[1fr_1.2fr]" un-gap="3">
                <Panel title="YES Market Depth" subtitle="Cumulative size (contracts) across price">
                    <DepthChart book={visibleBook} metrics={metrics} />
                </Panel>

                <Panel title="YES Market Book" subtitle="Asks derived from NO bids (1 − no). Bids = YES bids">
                    <CombinedYesLadder book={visibleBook} metrics={metrics} />
                </Panel>
            </div>

            <div un-grid="~ cols-2" un-gap="3">
                <Panel title="Raw YES Bids" subtitle="Offers to buy YES">
                    <RawLadder levels={sortedLevels(visibleBook.yes, true)} color="green" />
                </Panel>
                <Panel title="Raw NO Bids" subtitle="Offers to buy NO">
                    <RawLadder levels={sortedLevels(visibleBook.no, true)} color="rose" />
                </Panel>
            </div>

        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Shared small bits
// ──────────────────────────────────────────────────────────────────────────

function Panel(props: { title: string; subtitle?: string; children: React.ReactNode; }) {
    return (
        <section un-bg="white" un-border="~ slate-200 rounded-xl" un-shadow="sm" un-overflow="hidden">
            <div un-p="x-4 y-3" un-border="b slate-100" un-flex="~ justify-between items-baseline">
                <div un-text="sm slate-900" un-font="semibold">
                    {props.title}
                </div>
                {props.subtitle && (
                    <div un-text="xs slate-500">{props.subtitle}</div>
                )}
            </div>
            <div un-p="3">{props.children}</div>
        </section>
    );
}

function Header(props: {
    ticker: string;
    conn: ConnState;
    connError: string | null;
    mode: Mode;
    closeCountdown: string;
    onModeLive: () => void;
    onModeReplay: () => void;
    onReconnect: () => void;
}) {
    const color =
        props.conn === 'open'
            ? 'emerald-500'
            : props.conn === 'connecting'
                ? 'amber-500'
                : props.conn === 'error'
                    ? 'rose-500'
                    : 'slate-400';

    return (
        <header un-flex="~ items-center justify-between" un-gap="3" un-flex-wrap="~">
            <div un-flex="~ items-center gap-3">
                <div un-w="10" un-h="10" un-rounded="xl" un-bg-gradient-to="tr" un-from-amber="400" un-to-orange="500" un-flex="~ items-center justify-center" un-shadow="md">
                    <CircleDot un-text='white' size={22} />
                </div>
                <div>
                    <h1 un-text="xl slate-900" un-font="bold" un-leading="tight">
                        Kalshi · Bitcoin 15-min
                    </h1>
                    <div un-flex="~ items-center gap-2" un-text="xs slate-500">
                        <span un-font="mono" un-text="slate-700">{props.ticker || '—'}</span>
                        <span>·</span>
                        <span>closes in {props.closeCountdown}</span>
                    </div>
                </div>
            </div>

            <div un-flex="~ items-center gap-2">
                <div un-flex="~ items-center gap-2" un-p="x-3 y-2" un-rounded="lg" un-bg="white" un-border="~ slate-200">
                    {props.conn === 'open' ? (
                        <Wifi size={14} className={`text-${color}`} />
                    ) : props.conn === 'error' || props.conn === 'closed' ? (
                        <WifiOff size={14} className={`text-${color}`} />
                    ) : (
                        <PlugZap size={14} className={`text-${color}`} />
                    )}
                    <span un-text={`xs ${color}`} un-font="semibold" un-uppercase="~" un-tracking="wide">
                        {props.conn}
                    </span>
                </div>

                <div un-flex="~" un-bg="white" un-border="~ slate-200 rounded-lg" un-overflow="hidden" un-text="xs">
                    <button
                        un-cursor="pointer"
                        un-p="x-3 y-2"
                        un-bg={props.mode === 'live' ? 'slate-900' : 'transparent'}
                        un-text={props.mode === 'live' ? 'white' : 'slate-600'}
                        un-font="semibold"
                        onClick={props.onModeLive}
                    >
                        LIVE
                    </button>
                    <button
                        un-cursor="pointer"
                        un-p="x-3 y-2"
                        un-bg={props.mode === 'replay' ? 'slate-900' : 'transparent'}
                        un-text={props.mode === 'replay' ? 'white' : 'slate-600'}
                        un-font="semibold"
                        onClick={props.onModeReplay}
                    >
                        REPLAY
                    </button>
                </div>

                <button
                    un-cursor="pointer"
                    un-flex="~ items-center gap-2"
                    un-p="x-3 y-2"
                    un-rounded="lg"
                    un-bg="white hover:slate-100"
                    un-border="~ slate-200"
                    un-text="xs slate-600"
                    onClick={props.onReconnect}
                    title="Reconnect to WebSocket"
                >
                    <Plug size={14} />
                    Reconnect
                </button>

                {props.connError && (
                    <div un-text="xs rose-600" un-font="medium" un-max-w="sm" un-truncate="~">
                        {props.connError}
                    </div>
                )}
            </div>
        </header>
    );
}

function StatsStrip(props: { metrics: Metrics; book: BookState; }) {
    const m = props.metrics;
    const card = (label: string, value: string, tone: 'green' | 'red' | 'slate' | 'blue' = 'slate') => {
        const toneColor =
            tone === 'green' ? 'emerald-600' : tone === 'red' ? 'rose-600' : tone === 'blue' ? 'sky-600' : 'slate-800';
        return (
            <div un-flex="1" un-min-w="36" un-bg="white" un-border="~ slate-200 rounded-xl" un-shadow="sm" un-p="3">
                <div un-text="xs slate-500" un-uppercase="~" un-tracking="wider">
                    {label}
                </div>
                <div un-text={`xl ${toneColor}`} un-font="mono bold" un-mt="1">
                    {value}
                </div>
            </div>
        );
    };

    return (
        <div un-grid="~ cols-[repeat(auto-fit,minmax(120px,1fr))]" un-gap="2">
            {card('Best YES Bid', m.bestYes ? `¢${(m.bestYes.price * 100).toFixed(1)}` : '—', 'green')}
            {card('Implied YES Ask', m.yesAsk != null ? `¢${(m.yesAsk * 100).toFixed(1)}` : '—', 'red')}
            {card('Mid', m.mid != null ? `¢${(m.mid * 100).toFixed(1)}` : '—', 'blue')}
            {card('Spread', m.spread != null ? `¢${(m.spread * 100).toFixed(1)}` : '—')}
            {card('YES Depth', `$${totalSize(props.book.yes).toFixed(0)}`, 'green')}
            {card('NO Depth', `$${totalSize(props.book.no).toFixed(0)}`, 'red')}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Depth chart
// ──────────────────────────────────────────────────────────────────────────

function DepthChart(props: { book: BookState; metrics: Metrics; }) {
    const width = 640;
    const height = 260;
    const padL = 36;
    const padR = 12;
    const padT = 12;
    const padB = 28;

    const yesBids: Level[] = sortedLevels(props.book.yes, true); // desc price
    const yesAsks: Level[] = impliedYesAsksFromNo(props.book.no); // asc price

    const bidCum = cumulativeDepth(yesBids);
    const askCum = cumulativeDepth(yesAsks);

    const maxCum = Math.max(
        bidCum.length ? bidCum[bidCum.length - 1].cum : 0,
        askCum.length ? askCum[askCum.length - 1].cum : 0,
        1,
    );

    const x = (p: number) => padL + p * (width - padL - padR);
    const y = (s: number) => height - padB - (s / maxCum) * (height - padT - padB);

    // Build step-area polygons for bids and asks.
    const bidPoly = buildStepPolygon(
        bidCum.map((d) => ({ price: d.price, cum: d.cum })).reverse(), // ascending price to best bid
        'bid',
        x,
        y,
        height - padB,
    );
    const askPoly = buildStepPolygon(askCum, 'ask', x, y, height - padB);

    return (
        <div un-w="full" un-overflow="auto">
            <svg viewBox={`0 0 ${width} ${height}`} un-w="full" un-h="auto" un-max-h="72" un-display="block">
                {/* grid */}
                {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                    <g key={p}>
                        <line x1={x(p)} y1={padT} x2={x(p)} y2={height - padB} stroke="#e2e8f0" strokeWidth={1} />
                        <text x={x(p)} y={height - padB + 16} fill="#64748b" fontSize={10} textAnchor="middle">
                            {(p * 100).toFixed(0)}¢
                        </text>
                    </g>
                ))}

                {/* polygons */}
                {bidPoly && <path d={bidPoly} fill="rgb(16 185 129 / 0.18)" stroke="rgb(16 185 129)" strokeWidth={1.5} />}
                {askPoly && <path d={askPoly} fill="rgb(244 63 94 / 0.18)" stroke="rgb(244 63 94)" strokeWidth={1.5} />}

                {/* mid price line */}
                {props.metrics.mid != null && (
                    <line
                        x1={x(props.metrics.mid)}
                        y1={padT}
                        x2={x(props.metrics.mid)}
                        y2={height - padB}
                        stroke="#0ea5e9"
                        strokeDasharray="4 3"
                        strokeWidth={1.2}
                    />
                )}

                {/* axes */}
                <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="#cbd5e1" />
                <line x1={padL} y1={padT} x2={padL} y2={height - padB} stroke="#cbd5e1" />

                {/* y-axis cum label */}
                <text x={4} y={padT + 10} fill="#64748b" fontSize={10}>
                    ${maxCum.toFixed(0)}
                </text>
            </svg>
        </div>
    );
}

function buildStepPolygon(
    points: { price: number; cum: number; }[],
    kind: 'bid' | 'ask',
    x: (p: number) => number,
    y: (s: number) => number,
    baseY: number,
): string | null {
    if (points.length === 0) return null;
    const parts: string[] = [];
    // Start at (first.price, baseY)
    const first = points[0];
    parts.push(`M ${x(first.price)} ${baseY}`);
    parts.push(`L ${x(first.price)} ${y(first.cum)}`);
    for (let i = 1; i < points.length; i++) {
        const cur = points[i];
        const prev = points[i - 1];
        // Horizontal to new price, then vertical to new cum.
        parts.push(`L ${x(cur.price)} ${y(prev.cum)}`);
        parts.push(`L ${x(cur.price)} ${y(cur.cum)}`);
    }
    const last = points[points.length - 1];
    parts.push(`L ${x(last.price)} ${baseY}`);
    parts.push('Z');
    return parts.join(' ');
    // kind is reserved for potential future styling differences.
    void kind;
}

// ──────────────────────────────────────────────────────────────────────────
// Ladders
// ──────────────────────────────────────────────────────────────────────────

function CombinedYesLadder(props: { book: BookState; metrics: Metrics; }) {
    const asksAsc = impliedYesAsksFromNo(props.book.no); // asc price
    const bidsDesc = sortedLevels(props.book.yes, true); // desc price
    const asksTop = asksAsc.slice(0, MAX_LEVELS_IN_LADDER).reverse();
    const bidsTop = bidsDesc.slice(0, MAX_LEVELS_IN_LADDER);
    const maxSize = Math.max(...asksTop.map((l) => l.size), ...bidsTop.map((l) => l.size), 1,);

    const row = (l: Level, kind: 'ask' | 'bid') => {
        const widthPct = (l.size / maxSize) * 100;
        const bg = kind === 'ask' ? 'rose-100' : 'emerald-100';
        const priceColor = kind === 'ask' ? 'rose-600' : 'emerald-600';
        return (
            <div key={`${kind}-${l.price}`} un-grid="~ cols-[1fr_80px_1fr]" un-items="center" un-text="sm" un-font="mono">
                {kind === 'bid' ? (
                    <div un-position="relative" un-text="right slate-700" un-p="y-0.5 x-2" >
                        <div un-position="absolute right-0" un-inset="y-0" un-bg={bg} style={{ width: `${widthPct}%` }} />
                        <span un-relative="~ z-10">${l.size.toFixed(0)}</span>
                    </div>
                ) : (
                    <div />
                )}
                <div un-text={`center ${priceColor}`} un-font="bold" >
                    ¢{(l.price * 100).toFixed(1)}
                </div>
                {kind === 'ask' ? (
                    <div un-position="relative" un-text="left slate-700" un-p="y-0.5 x-2" >
                        <div un-position="absolute"
                            un-inset="y-0"
                            un-bg={bg}
                            style={{ width: `${widthPct}%` }} />
                        <span un-relative="~ z-10">${l.size.toFixed(0)}</span>
                    </div>
                ) : (
                    <div />
                )}
            </div>
        );
    };

    return (
        <div un-flex="~ col" un-gap="0.5" un-text="xs">
            <div un-grid="~ cols-[1fr_80px_1fr]" un-bg="slate-50" un-p="y-1" un-text="xs slate-500 center">
                <div un-text="right" un-p-r="2">Bid size</div>
                <div>Price (YES)</div>
                <div un-text="left" un-p-l="2">Ask size</div>
            </div>

            {asksTop.length === 0 && <div un-text="center slate-400" un-p="y-2">No asks</div>}
            {asksTop.map((l) => row(l, 'ask'))}

            <div un-bg="sky-50" un-p="y-1" un-my="1" un-text="center sky-700" un-font="mono semibold">
                {props.metrics.mid != null ? `Mid ¢${(props.metrics.mid * 100).toFixed(1)}` : '—'}
                {props.metrics.spread != null && (
                    <span un-ml="2" un-text="xs slate-500">(spread ¢{(props.metrics.spread * 100).toFixed(1)})</span>
                )}
            </div>

            {bidsTop.map((l) => row(l, 'bid'))}
            {bidsTop.length === 0 && <div un-text="center slate-400" un-p="y-2">No bids</div>}
        </div>
    );
}

function RawLadder(props: { levels: Level[]; color: 'green' | 'rose'; }) {
    const top = props.levels.slice(0, MAX_LEVELS_IN_LADDER);
    const max = Math.max(...top.map((l) => l.size), 1);
    const priceColor = props.color === 'green' ? 'emerald-700' : 'rose-700';
    const barBg = props.color === 'green' ? 'emerald-100' : 'rose-100';

    return (
        <div un-flex="~ col" un-text="sm font-mono">
            <div un-grid="~ cols-2" un-bg="slate-50" un-p="y-1" un-text="xs slate-500 center">
                <div>Price</div>
                <div>Size</div>
            </div>
            {top.length === 0 && <div un-text="center slate-400" un-p="y-2">(empty)</div>}
            {top.map((l) => {
                const widthPct = (l.size / max) * 100;
                return (
                    <div key={l.price} un-grid="~ cols-2" un-items="center" un-hover="bg-slate-50">
                        <div un-text={`center ${priceColor}`} un-font="bold">
                            ¢{(l.price * 100).toFixed(1)}
                        </div>
                        <div un-position="relative" un-text="left slate-700" un-p="y-0.5 x-2">
                            <div un-position="absolute" un-inset="y-0" un-bg={barBg} style={{ width: `${widthPct}%` }} />
                            <span un-relative="~ z-10">${l.size.toFixed(0)}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Replay panel
// ──────────────────────────────────────────────────────────────────────────

function ReplayPanel(props: {
    mode: Mode;
    recording: boolean;
    onToggleRecording: () => void;
    onClear: () => void;
    onDownload: () => void;
    onUpload: (file: File) => void;
    liveRecording: Recording | null;
    loaded: Recording | null;
    cursor: number;
    setCursor: (i: number) => void;
    playing: boolean;
    setPlaying: (v: boolean) => void;
    speed: (typeof REPLAY_SPEEDS)[number];
    setSpeed: (v: (typeof REPLAY_SPEEDS)[number]) => void;
    onEnterReplay: () => void;
    onExitReplay: () => void;
    onUseLiveAsReplay: () => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const rec = props.mode === 'replay' ? props.loaded : props.liveRecording;
    const total = rec?.events.length ?? 0;
    const idx = Math.min(props.cursor, Math.max(total - 1, 0));
    const current = total > 0 ? rec!.events[idx] : null;

    return (
        <section un-bg="white" un-border="~ slate-200 rounded-xl" un-shadow="sm" un-p="3" un-flex="~ col" un-gap="3">
            <div un-flex="~ items-center justify-between" un-gap="2" un-flex-wrap="~">
                <div un-flex="~ items-center gap-2">
                    <span un-text="sm slate-900" un-font="semibold">Recorder · Replay</span>
                    <span un-text="xs slate-500">
                        {total} events
                        {rec && ` · ${rec.market_ticker}`}
                    </span>
                </div>

                <div un-flex="~ items-center gap-2">
                    <button
                        un-cursor="pointer"
                        un-flex="~ items-center gap-2"
                        un-p="x-3 y-2"
                        un-text="xs white"
                        un-font="semibold"
                        un-bg={props.recording ? 'rose-600 hover:rose-700' : 'slate-700 hover:slate-800'}
                        un-border="rounded-lg slate-200 ~ "
                        onClick={props.onToggleRecording}
                        disabled={props.mode !== 'live'}
                        style={{ opacity: props.mode !== 'live' ? 0.5 : 1 }}
                        title={props.mode !== 'live' ? 'Only available in live mode' : undefined}
                    >
                        {props.recording ? <Square size={14} /> : <CircleDot size={14} />}
                        {props.recording ? 'Stop recording' : 'Record'}
                    </button>

                    <button
                        un-cursor="pointer"
                        un-flex="~ items-center gap-2"
                        un-p="x-3 y-2"
                        un-rounded="lg"
                        un-border="~ slate-200"
                        un-bg="hover:slate-50"
                        un-text="xs slate-700"
                        onClick={props.onDownload}
                        disabled={total === 0}
                        style={{ opacity: total === 0 ? 0.5 : 1 }}
                    >
                        <Download size={14} />
                        Download
                    </button>

                    <button
                        un-cursor="pointer"
                        un-flex="~ items-center gap-2"
                        un-p="x-3 y-2"
                        un-rounded="lg"
                        un-border="~ slate-200"
                        un-bg="hover:slate-50"
                        un-text="xs slate-700"
                        onClick={() => fileRef.current?.click()}
                    >
                        <Upload size={14} />
                        Load…
                    </button>

                    <input
                        ref={fileRef}
                        type="file"
                        accept="application/json,.json"
                        un-hidden="~"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) props.onUpload(f);
                            e.target.value = '';
                        }}
                    />

                    <button
                        un-cursor="pointer"
                        un-p="x-3 y-2"
                        un-rounded="lg"
                        un-border="~ slate-200"
                        un-bg="hover:slate-50"
                        un-text="xs slate-700"
                        onClick={props.onClear}
                    >
                        Clear
                    </button>

                    {props.mode === 'live' && props.liveRecording && props.liveRecording.events.length > 0 && (
                        <button
                            un-cursor="pointer"
                            un-p="x-3 y-2"
                            un-rounded="lg"
                            un-bg="sky-600 hover:sky-700"
                            un-text="xs white"
                            un-font="semibold"
                            onClick={props.onUseLiveAsReplay}
                        >
                            Replay current session
                        </button>
                    )}
                </div>
            </div>

            {/* Transport controls */}
            <div un-flex="~ items-center gap-3 wrap">
                <button
                    un-cursor="pointer"
                    un-p="2"
                    un-rounded="full"
                    un-bg="slate-100 hover:slate-200"
                    onClick={() => {
                        props.onEnterReplay();
                        props.setCursor(0);
                    }}
                    disabled={total === 0}
                >
                    <ChevronsLeft size={16} />
                </button>
                <button
                    un-cursor="pointer"
                    un-p="2"
                    un-rounded="full"
                    un-bg="slate-100 hover:slate-200"
                    onClick={() => {
                        props.onEnterReplay();
                        props.setCursor(Math.max(idx - 10, 0));
                    }}
                    disabled={total === 0}
                >
                    <Rewind size={16} />
                </button>

                <button
                    un-cursor="pointer"
                    un-p="3"
                    un-rounded="full"
                    un-bg={props.playing ? 'rose-600 hover:rose-700' : 'emerald-600 hover:emerald-700'}
                    un-text="white"
                    un-shadow="md"
                    onClick={() => {
                        props.onEnterReplay();
                        props.setPlaying(!props.playing);
                    }}
                    disabled={total === 0}
                >
                    {props.playing ? <Pause size={18} /> : <Play size={18} />}
                </button>

                <button
                    un-cursor="pointer"
                    un-p="2"
                    un-rounded="full"
                    un-bg="slate-100 hover:slate-200"
                    onClick={() => {
                        props.onEnterReplay();
                        props.setCursor(Math.min(idx + 10, Math.max(total - 1, 0)));
                    }}
                    disabled={total === 0}
                >
                    <FastForward size={16} />
                </button>
                <button
                    un-cursor="pointer"
                    un-p="2"
                    un-rounded="full"
                    un-bg="slate-100 hover:slate-200"
                    onClick={() => {
                        props.onEnterReplay();
                        props.setCursor(Math.max(total - 1, 0));
                    }}
                    disabled={total === 0}
                >
                    <ChevronsRight size={16} />
                </button>

                <div un-flex="~ items-center gap-1" un-ml="2">
                    {REPLAY_SPEEDS.map((s) => (
                        <button
                            key={s}
                            un-cursor="pointer"
                            un-p="x-2 y-1"
                            un-text={`xs ${props.speed === s ? 'white' : 'slate-600'}`}
                            un-bg={props.speed === s ? 'slate-900' : 'white hover:slate-100'}
                            un-border="~ slate-200 rounded-md"
                            un-font="semibold"
                            onClick={() => props.setSpeed(s)}
                        >
                            {s}×
                        </button>
                    ))}
                </div>

                <div un-flex="1" un-min-w="60">
                    <input
                        type="range"
                        min={0}
                        max={Math.max(total - 1, 0)}
                        value={idx}
                        un-w="full"
                        onChange={(e) => {
                            props.onEnterReplay();
                            props.setCursor(Number(e.target.value));
                        }}
                        disabled={total === 0}
                    />
                </div>

                <div un-text="xs slate-600" un-font="mono" un-min-w="32">
                    {total > 0 ? `${idx + 1} / ${total}` : '0 / 0'}
                </div>
            </div>

            {current && (
                <div un-p="2" un-rounded="lg" un-bg="slate-50" un-text="xs slate-700" un-font="mono" un-flex="~ col" un-gap="1">
                    <div>
                        <span un-text={current.type === 'snapshot' ? 'sky-700' : 'slate-700'} un-font="bold">
                            {current.type.toUpperCase()}
                        </span>
                        <span un-ml="2" un-text="slate-500">
                            {formatEt(new Date(current.recvTs))}
                            {current.seq != null && ` · seq ${current.seq}`}
                        </span>
                    </div>
                    {current.type === 'delta' && (
                        <div>
                            {current.data.side.toUpperCase()} ¢{(parseFloat(current.data.price_dollars) * 100).toFixed(1)} Δ{' '}
                            <span un-text={parseFloat(current.data.delta_fp) >= 0 ? 'emerald-700' : 'rose-700'}>
                                {parseFloat(current.data.delta_fp) >= 0 ? '+' : ''}
                                {parseFloat(current.data.delta_fp).toFixed(2)}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Small hooks / helpers
// ──────────────────────────────────────────────────────────────────────────

function useCountdown(unixTs: number): string {
    // Start at 0 so server and client render the same string on first paint.
    const [now, setNow] = useState<number>(0);
    useEffect(() => {
        setNow(Date.now());
        const i = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(i);
    }, []);
    if (now === 0 || unixTs === 0) return '--:--';
    const s = Math.max(Math.floor(unixTs - now / 1000), 0);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

type Metrics = {
    bestYes: Level | null;
    bestNo: Level | null;
    yesAsk: number | null;
    mid: number | null;
    spread: number | null;
};

function computeMetrics(book: BookState): Metrics {
    const by = bestBid(book.yes);
    const bn = bestBid(book.no);
    const yesAsk = bn ? +(1 - bn.price).toFixed(4) : null;
    const mid = by && yesAsk != null ? +((by.price + yesAsk) / 2).toFixed(4) : null;
    const spread = by && yesAsk != null ? +(yesAsk - by.price).toFixed(4) : null;
    return { bestYes: by, bestNo: bn, yesAsk, mid, spread };
}

function appendEvent(
    rec: Recording | null,
    market_ticker: string,
    market_id: string,
    ev: RecordedEvent,
): Recording {
    if (!rec) {
        return {
            id: `rec_${Date.now()}`,
            market_ticker,
            market_id,
            startedAt: ev.recvTs,
            events: [ev],
        };
    }
    if (rec.market_ticker && rec.market_ticker !== market_ticker) {
        // Started a new market mid-recording: fork a fresh one so events stay consistent.
        return {
            id: `rec_${Date.now()}`,
            market_ticker,
            market_id,
            startedAt: ev.recvTs,
            events: [ev],
        };
    }
    return {
        ...rec,
        market_ticker: rec.market_ticker || market_ticker,
        market_id: rec.market_id || market_id,
        events: [...rec.events, ev],
    };
}


export const UnoTrick = <div un-bg="rose-600 hover:rose-700 slate-700 hover:slate-800 rose-100 emerald-100" />;