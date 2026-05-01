import {
    fmtBtc,
    fmtUsd,
    type AggTradeBucket,
    type CostToBreak, type CostToStrike, type DepthSnapshot,
    type TradeFlowMetrics,
} from '@/utils/binance/binance';
import { useCountdown, useDashboard } from '@/utils/binance/hooks';
import {
    bestBid, impliedYesAsksFromNo, sortedLevels,
    type BookState, type Level,
} from '@/utils/kalshi/orderbook';
import { createFileRoute } from '@tanstack/react-router';
import { CircleDot, Download, PlugZap, Wifi, WifiOff } from 'lucide-react';
import { useMemo } from 'react';

export const Route = createFileRoute('/combo/kalshi-bitcoin')({ component: KalshiBitcoinBinance });

function KalshiBitcoinBinance() {
    const d = useDashboard();
    const countdown = useCountdown(d.closeTs);
    const km = useMemo(() => {
        const by = bestBid(d.kalshiBook.yes);
        const bn = bestBid(d.kalshiBook.no);
        const yesAsk = bn ? +(1 - bn.price).toFixed(4) : null;
        const mid = by && yesAsk != null ? +((by.price + yesAsk) / 2).toFixed(4) : null;
        const spread = by && yesAsk != null ? +(yesAsk - by.price).toFixed(4) : null;
        return { bestYes: by, bestNo: bn, yesAsk, mid, spread };
    }, [d.kalshiBook]);

    const strike = d.floorStrike;
    const openPrice = d.binance.windowOpenPrice;
    const pΔ = openPrice ? d.binance.lastPrice - openPrice : 0;
    const strikeΔ = strike && d.binance.lastPrice ? d.binance.lastPrice - strike : null;
    const cts = d.costToStrike;

    const dlRec = (rec: typeof d.recording) => {
        if (!rec || rec.events.length === 0) return;
        const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'combined_' + (rec.kalshiTicker || 'rec') + '_' + new Date(rec.startedAt).toISOString().replace(/[:.]/g, '-') + '.json';
        a.click(); URL.revokeObjectURL(a.href);
    };

    return (
        <div un-p="2" un-flex="~ col gap-2" >
            <header un-flex="~ items-center justify-between gap-3 wrap" >
                <div un-flex="~ items-center gap-3">
                    <div un-w="10" un-h="10" un-rounded="xl" un-bg-gradient-to="tr" un-from-violet="500" un-to-amber="400" un-flex="~ items-center justify-center" un-shadow="md">
                        <CircleDot un-text="white" size={22} />
                    </div>
                    <div>
                        <h1 un-text="xl slate-900" un-font="bold">Kalshi X Binance · BTC 15m</h1>
                        <div un-flex="~ items-center gap-2" un-text="xs slate-500">
                            <span un-font="mono" un-text="slate-700">{d.ticker ?? "—"}</span>
                            <span>·</span>
                            <span>closes in {countdown}</span>
                            {strike && <><span>·</span><span un-font="mono" un-text="amber-700">Kalshi Strike ${strike.toLocaleString()}</span></>}
                        </div>
                    </div>
                </div>
                <div un-flex="~ items-center gap-2">
                    <CB label="Kalshi" state={d.kalshiConn} />
                    <CB label="Binance" state={d.binanceConn} />
                    {d.kalshiError && <div un-text="xs rose-600" un-max-w="xs" un-truncate="~">{d.kalshiError}</div>}
                </div>
            </header>

            {/* Strike Context */}
            {d.marketCtx && (
                <div un-bg="amber-50" un-border="~ amber-200 rounded-xl" un-p="3" un-flex="~ items-center gap-4 wrap" un-text="sm">
                    <div un-font="bold" un-text="amber-800">⚡ Strike Context</div>
                    <div>Kalshi Strike: <b un-font="mono">${strike?.toLocaleString()}</b></div>
                    <div>Binance Open Price: <b un-font="mono">${openPrice?.toFixed(1)}</b></div>
                    <div>Binance Kalshi slippage <b un-font="mono">{(d.marketCtx.binanceOpenPrice - d.marketCtx.floorStrike)?.toFixed(2)}</b></div>
                    {strikeΔ != null && <div>Current Binance vs Kalshi Strike: <b un-font="mono" un-text={strikeΔ >= 0 ? "emerald-700" : "rose-700"}>{(strikeΔ >= 0 ? "+" : "") + "$" + strikeΔ.toFixed(1)}</b></div>}
                    {cts && <div>Cost to Strike: <b un-font="mono" un-text={cts.distanceToStrike > 0 ? "rose-700" : "emerald-700"}>{cts.distanceToStrike > 0 ? "↓ " + fmtUsd(cts.costDown) : "↑ " + fmtUsd(cts.costUp)}</b></div>}
                </div>
            )}

            <div un-grid="~ cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
                <MC label="Binance Price" value={d.binance.lastPrice ? "$" + d.binance.lastPrice.toFixed(1) : "—"} tone="blue" />
                <MC label="Binance vs Kalshi Strike" value={strikeΔ != null ? (strikeΔ >= 0 ? "+" : "") + "$" + strikeΔ.toFixed(1) : "—"} tone={strikeΔ != null ? (strikeΔ >= 0 ? "green" : "red") : "slate"} />
                <MC label="Binance vs Open" value={pΔ !== 0 ? (pΔ >= 0 ? "+" : "") + "$" + pΔ.toFixed(1) : "—"} tone={pΔ >= 0 ? "green" : "red"} />
                <MC label="Kalshi YES Mid" value={km.mid != null ? "¢" + (km.mid * 100).toFixed(1) : "—"} tone="green" />
                <MC label="Kalshi Spread" value={km.spread != null ? "¢" + (km.spread * 100).toFixed(1) : "—"} />
                <MC label="Cost→Strike" value={cts ? (cts.distanceToStrike > 0 ? "↓" + fmtUsd(cts.costDown) : "↑" + fmtUsd(cts.costUp)) : "—"}
                    tone={cts ? (cts.distanceToStrike > 0 ? 'red' : 'green') : 'slate'} />
                <MC label="Flow Imb 30s" value={d.tradeFlow30s.totalVolume > 0 ? (d.tradeFlow30s.imbalance * 100).toFixed(1) + "%" : "—"}
                    tone={d.tradeFlow30s.imbalance > 0.1 ? 'green' : d.tradeFlow30s.imbalance < -0.1 ? 'red' : 'slate'} />
                <MC label="Trades/sec" value={d.tradeFlow30s.tradesPerSec > 0 ? d.tradeFlow30s.tradesPerSec.toFixed(1) : "—"} />
            </div>

            <P title="Time-Aligned Price Chart" subtitle={strike ? "BTC price (blue) · Strike $" + strike.toLocaleString() + " (dashed orange)" : "BTC price (blue)"}>
                <DualChart tradeBuckets={d.binance.tradeBuckets} strike={strike} openPrice={openPrice} />
            </P>

            <div un-grid="~ cols-2" un-gap="3">
                <P title="Cost-to-Break from Strike" subtitle={strike ? "Offsets from strike $" + strike.toLocaleString() : "USDT to sweep orderbook"}>
                    <CTB costs={d.costToBreak} strike={strike ?? d.binance.lastPrice} costToStrike={cts} />
                </P>
                <P title="Binance Order Book" subtitle="Top 20 levels · BTCUSDT">
                    <BDV depth={d.binance.depth} />
                </P>
            </div>

            <div un-grid="~ cols-2" un-gap="3">
                <P title="Trade Flow" subtitle="1s volume buckets · green=buy, red=sell">
                    <TF buckets={d.binance.tradeBuckets} f30={d.tradeFlow30s} f60={d.tradeFlow60s} />
                </P>
                <P title="Kalshi YES Book" subtitle="Bids vs Asks (from NO bids)">
                    <KL book={d.kalshiBook} m={km} />
                </P>
            </div>

            <P title="Recorder" subtitle={(d.recording?.events.length ?? 0) + " events · " + d.ticker}>
                <div un-flex="~ items-center gap-2 wrap">
                    <button un-cursor="pointer" un-p="x-3 y-2" un-rounded="lg" un-text="xs white" un-font="semibold"
                        un-bg={d.isRecording ? 'rose-600 hover:rose-700' : 'slate-700 hover:slate-800'}
                        onClick={() => d.setIsRecording(!d.isRecording)}>
                        {d.isRecording ? '⏹ Stop' : '⏺ Record'}
                    </button>
                    <button un-cursor="pointer" un-flex="~ items-center gap-1" un-p="x-3 y-2" un-rounded="lg"
                        un-border="~ slate-200" un-bg="hover:slate-50" un-text="xs slate-700"
                        onClick={() => dlRec(d.recording)} disabled={!d.recording}>
                        <Download size={14} /> Current
                    </button>
                    {d.previousRecording && (
                        <button un-cursor="pointer" un-flex="~ items-center gap-1" un-p="x-3 y-2" un-rounded="lg"
                            un-border="~ slate-200" un-bg="sky-50 hover:sky-100" un-text="xs sky-700"
                            onClick={() => dlRec(d.previousRecording)}>
                            <Download size={14} /> Previous Window
                        </button>
                    )}
                    <span un-text="xs slate-500" un-ml="2">
                        {d.previousRecording ? 'Prev: ' + d.previousRecording.events.length + ' events' : 'No previous window'}
                    </span>
                </div>
            </P>
        </div>
    );
}

// ── Shared ───────────────────────────────────────────────────────────────

function CB({ label, state }: { label: string; state: string }) {
    const c = state === 'open' ? 'emerald-500' : state === 'connecting' ? 'amber-500' : state === 'error' ? 'rose-500' : 'slate-400';
    const Icon = state === 'open' ? Wifi : (state === 'error' || state === 'closed') ? WifiOff : PlugZap;
    return (
        <div un-flex="~ items-center gap-1.5" un-p="x-2.5 y-1.5" un-rounded="lg" un-bg="white" un-border="~ slate-200" un-text="xs">
            <Icon size={12} className={'text-' + c} />
            <span un-text={c} un-font="semibold">{label}</span>
        </div>
    );
}

function MC({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'green' | 'red' | 'slate' | 'blue' }) {
    const c = tone === 'green' ? 'emerald-600' : tone === 'red' ? 'rose-600' : tone === 'blue' ? 'sky-600' : 'slate-800';
    return (
        <div un-bg="white" un-border="~ slate-200 rounded-xl" un-shadow="sm" un-p="3">
            <div un-text="xs slate-500" un-uppercase="~" un-tracking="wider">{label}</div>
            <div un-text={'lg ' + c} un-font='mono bold' un-mt='0.5'>{value}</div>
        </div>
    );
}

function P({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <section un-bg="white" un-border="~ slate-200 rounded-xl" un-shadow="sm" un-overflow="hidden">
            <div un-p="x-4 y-3" un-border="b slate-100" un-flex="~ justify-between items-baseline">
                <div un-text="sm slate-900" un-font="semibold">{title}</div>
                {subtitle && <div un-text="xs slate-500">{subtitle}</div>}
            </div>
            <div un-p="3">{children}</div>
        </section>
    );
}

// ── Charts ───────────────────────────────────────────────────────────────

function DualChart({ tradeBuckets, strike, openPrice }: { tradeBuckets: AggTradeBucket[]; strike?: number | null; openPrice?: number | null }) {
    const W = 800, H = 220, PL = 60, PR = 60, PT = 16, PB = 28;

    if (tradeBuckets.length < 2) return <div un-text="center slate-400" un-p="8">Waiting for data…</div>;

    const prices = tradeBuckets.map(k => k.close);
    const minP = Math.min(...prices), maxP = Math.max(...prices);
    const rP = Math.max(maxP - minP, 1);
    const minT = tradeBuckets[0].ts, maxT = tradeBuckets[tradeBuckets.length - 1].ts;
    const rT = Math.max(maxT - minT, 1);
    const xf = (t: number) => PL + ((t - minT) / rT) * (W - PL - PR);
    const yf = (p: number) => PT + (1 - (p - minP) / rP) * (H - PT - PB);

    const line = tradeBuckets.map((k, i) => (i === 0 ? 'M' : 'L') + ' ' + xf(k.ts).toFixed(1) + ' ' + yf(k.close).toFixed(1)).join(' ');
    const maxVol = Math.max(...tradeBuckets.map(b => b.volume), 0.001);

    return (
        <div un-w="full" un-overflow="auto">
            <svg viewBox={'0 0 ' + W + ' ' + H} un-w='full' un-h='auto' un-max-h='56' un-display='block'>
                {[0, 0.25, 0.5, 0.75, 1].map(f => {
                    const p = minP + f * rP;
                    return <g key={f}>
                        <line x1={PL} y1={yf(p)} x2={W - PR} y2={yf(p)} stroke="#e2e8f0" strokeWidth={0.5} />
                        <text x={PL - 4} y={yf(p) + 4} fill="#64748b" fontSize={9} textAnchor="end">{"$" + p.toFixed(0)}</text>
                    </g>;
                })}
                {tradeBuckets.slice(-120).map((b, i) => {
                    const bx = xf(b.ts); const bh = (b.volume / maxVol) * 30;
                    return <rect key={i} x={bx - 2} y={H - PB - bh} width={3} height={bh}
                        fill={b.buyVolume > b.sellVolume ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.35)'} />;
                })}
                <path d={line} fill="none" stroke="#3b82f6" strokeWidth={1.8} />
                <text x={W - PR + 4} y={yf(prices[prices.length - 1]) + 4} fill="#3b82f6" fontSize={10} fontWeight="bold">
                    {'$' + prices[prices.length - 1].toFixed(1)}
                </text>
                {/* Strike price line */}
                {strike && strike >= minP && strike <= maxP && (
                    <><line x1={PL} y1={yf(strike)} x2={W - PR} y2={yf(strike)} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 3" />
                        <text x={W - PR + 4} y={yf(strike) + 4} fill="#f59e0b" fontSize={9} fontWeight="bold">{"Strike $" + strike.toLocaleString()}</text></>
                )}
                {/* Open price line */}
                {openPrice && openPrice >= minP && openPrice <= maxP && (
                    <><line x1={PL} y1={yf(openPrice)} x2={W - PR} y2={yf(openPrice)} stroke="#8b5cf6" strokeWidth={1} strokeDasharray="4 4" />
                        <text x={W - PR + 4} y={yf(openPrice) - 4} fill="#8b5cf6" fontSize={8}>{"Open $" + openPrice.toFixed(0)}</text></>
                )}
                <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="#cbd5e1" />
                <line x1={PL} y1={PT} x2={PL} y2={H - PB} stroke="#cbd5e1" />
            </svg>
        </div>
    );
}

function CTB({ costs, strike, costToStrike }: { costs: CostToBreak[]; strike: number; costToStrike: CostToStrike | null }) {
    if (costs.length === 0) return <div un-text="center slate-400" un-p="4">Waiting for depth…</div>;
    const maxC = Math.max(...costs.map(c => c.costUsdt), 1);
    const ups = costs.filter(c => c.direction === 'up');
    const downs = costs.filter(c => c.direction === 'down').reverse();

    const row = (c: CostToBreak) => {
        const pct = (c.costUsdt / maxC) * 100;
        const isUp = c.direction === 'up';
        const off = Math.abs(c.priceTarget - strike);
        const sev = c.costUsdt < 500_000 ? 'rose' : c.costUsdt < 2_000_000 ? 'amber' : 'emerald';
        return (
            <div key={c.direction + '-' + c.priceTarget} un-grid='~ cols-[100px_1fr_100px]' un-items='center' un-text='sm' un-font='mono' un-gap='2'>
                <div un-text={isUp ? 'right emerald-700' : 'right rose-700'} un-font='bold'>
                    {(isUp ? '↑' : '↓') + ' $' + off.toFixed(0)}
                </div>
                <div un-position="relative" un-h="6" un-bg="slate-50" un-rounded="md" un-overflow="hidden">
                    <div un-position="absolute" un-inset="y-0" un-bg={sev + "-200"} un-rounded="md"
                        style={{ width: pct + '%', left: isUp ? 0 : undefined, right: isUp ? undefined : 0 }} />
                    <span un-position="relative" un-p="x-2" un-text={"xs " + sev + "-800"} un-font="bold" un-leading="6">
                        {fmtUsd(c.costUsdt) + ' · ' + fmtBtc(c.depthBtc)}
                    </span>
                </div>
                <div un-text={'xs ' + sev + '-600'}>{c.levels} levels</div>
            </div>
        );
    };

    return (
        <div un-flex="~ col" un-gap="1">
            <div un-text="xs slate-500 center" un-p="y-1" un-bg="slate-50">ASK SIDE (push price UP from strike)</div>
            {ups.map(row)}
            <div un-bg="amber-50" un-p="y-1.5" un-text="center amber-800" un-font="mono bold" un-my="1">
                {'Strike $' + strike.toLocaleString()}
                {costToStrike && <span un-ml="2" un-text="xs slate-600">{"(BTC mid $" + costToStrike.currentMid.toFixed(1) + ", " + (costToStrike.distanceToStrike >= 0 ? "+" : "") + "$" + costToStrike.distanceToStrike.toFixed(1) + ")"}</span>}
            </div>
            <div un-text="xs slate-500 center" un-p="y-1" un-bg="slate-50">BID SIDE (push price DOWN)</div>
            {downs.map(row)}
        </div>
    );
}

function BDV({ depth }: { depth: DepthSnapshot | null }) {
    if (!depth) return <div un-text="center slate-400" un-p="4">Waiting for depth…</div>;
    const maxQ = Math.max(...depth.bids.map(b => b[1]), ...depth.asks.map(a => a[1]), 0.01);

    return (
        <div un-flex="~ col" un-gap="0.5" un-text="xs" un-font="mono">
            <div un-grid="~ cols-[1fr_100px_1fr]" un-bg="slate-50" un-p="y-1" un-text="center slate-500">
                <div un-text="right" un-p-r="2">Bid Qty</div><div>Price</div><div un-text="left" un-p-l="2">Ask Qty</div>
            </div>
            {[...depth.asks].reverse().slice(0, 12).map(([p, q], i) => (
                <div key={'a' + i} un-grid='~ cols-[1fr_100px_1fr]' un-items='center'>
                    <div />
                    <div un-text="center rose-600" un-font="bold">{"$" + p.toFixed(1)}</div>
                    <div un-position="relative" un-text="left slate-700" un-p="y-0.5 x-2">
                        <div un-position="absolute" un-inset="y-0" un-bg="rose-100" style={{ width: (q / maxQ) * 100 + "%" }} />
                        <span un-relative="~ z-10">{q.toFixed(4)}</span>
                    </div>
                </div>
            ))}
            <div un-bg="sky-50" un-p="y-1" un-text="center sky-700" un-font="bold">
                {'Spread $' + (depth.asks[0] && depth.bids[0] ? (depth.asks[0][0] - depth.bids[0][0]).toFixed(2) : '—')}
            </div>
            {depth.bids.slice(0, 12).map(([p, q], i) => (
                <div key={'b' + i} un-grid='~ cols-[1fr_100px_1fr]' un-items='center'>
                    <div un-position="relative" un-text="right slate-700" un-p="y-0.5 x-2">
                        <div un-position="absolute right-0" un-inset="y-0" un-bg="emerald-100" style={{ width: (q / maxQ) * 100 + "%" }} />
                        <span un-relative="~ z-10">{q.toFixed(4)}</span>
                    </div>
                    <div un-text="center emerald-600" un-font="bold">{"$" + p.toFixed(1)}</div>
                    <div />
                </div>
            ))}
        </div>
    );
}

function TF({ buckets, f30, f60 }: { buckets: AggTradeBucket[]; f30: TradeFlowMetrics; f60: TradeFlowMetrics }) {
    const recent = buckets.slice(-60);
    if (recent.length === 0) return <div un-text="center slate-400" un-p="4">Waiting for trades…</div>;
    const maxV = Math.max(...recent.map(b => b.volume), 0.001);

    return (
        <div un-flex="~ col" un-gap="2">
            <div un-flex="~ gap-4" un-text="xs slate-600">
                <span>30s: <b un-text={f30.imbalance > 0 ? 'emerald-700' : 'rose-700'}>{(f30.imbalance * 100).toFixed(1)}%</b> buy</span>
                <span>60s: <b un-text={f60.imbalance > 0 ? 'emerald-700' : 'rose-700'}>{(f60.imbalance * 100).toFixed(1)}%</b> buy</span>
                <span>Vol: <b>{fmtBtc(f30.totalVolume)}</b>/30s</span>
            </div>
            <div un-flex="~ items-end gap-px" un-h="24" un-bg="slate-50" un-rounded="md" un-overflow="hidden">
                {recent.map((b, i) => {
                    const h = (b.volume / maxV) * 100;
                    const br = b.volume > 0 ? b.buyVolume / b.volume : 0.5;
                    return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'flex-end' }}>
                            <div style={{ height: (h * br) + '%', background: 'rgb(16 185 129 / 0.6)', minHeight: b.volume > 0 ? 1 : 0 }} />
                            <div style={{ height: (h * (1 - br)) + '%', background: 'rgb(244 63 94 / 0.6)', minHeight: b.volume > 0 ? 1 : 0 }} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function KL({ book, m }: { book: BookState; m: { bestYes: Level | null; yesAsk: number | null; mid: number | null; spread: number | null } }) {
    const asksTop = impliedYesAsksFromNo(book.no).slice(0, 10).reverse();
    const bidsTop = sortedLevels(book.yes, true).slice(0, 10);
    const maxS = Math.max(...asksTop.map(l => l.size), ...bidsTop.map(l => l.size), 1);

    const row = (l: Level, kind: 'ask' | 'bid') => {
        const w = (l.size / maxS) * 100;
        const bg = kind === 'ask' ? 'rose-100' : 'emerald-100';
        const pc = kind === 'ask' ? 'rose-600' : 'emerald-600';
        return (
            <div key={kind + '-' + l.price} un-grid='~ cols-[1fr_70px_1fr]' un-items='center' un-text='xs' un-font='mono'>
                {kind === 'bid' ? (
                    <div un-position="relative" un-text="right slate-700" un-p="y-0.5 x-2">
                        <div un-position="absolute right-0" un-inset="y-0" un-bg={bg} style={{ width: w + "%" }} />
                        <span un-relative="~ z-10">{"$" + l.size.toFixed(0)}</span>
                    </div>
                ) : <div />}
                <div un-text={'center ' + pc} un-font='bold'>{'¢' + (l.price * 100).toFixed(1)}</div>
                {kind === 'ask' ? (
                    <div un-position="relative" un-text="left slate-700" un-p="y-0.5 x-2">
                        <div un-position="absolute" un-inset="y-0" un-bg={bg} style={{ width: w + "%" }} />
                        <span un-relative="~ z-10">{"$" + l.size.toFixed(0)}</span>
                    </div>
                ) : <div />}
            </div>
        );
    };

    return (
        <div un-flex="~ col" un-gap="0.5">
            {asksTop.length === 0 && <div un-text="center slate-400 xs" un-p="y-1">No asks</div>}
            {asksTop.map(l => row(l, 'ask'))}
            <div un-bg="sky-50" un-p="y-1" un-text="center sky-700 xs" un-font="mono bold">
                {m.mid != null ? 'Mid ¢' + (m.mid * 100).toFixed(1) : '—'}
                {m.spread != null && <span un-ml="2" un-text="slate-500">{"(spread ¢" + (m.spread * 100).toFixed(1) + ")"}</span>}
            </div>
            {bidsTop.map(l => row(l, 'bid'))}
            {bidsTop.length === 0 && <div un-text="center slate-400 xs" un-p="y-1">No bids</div>}
        </div>
    );
}

export const UnoTrick = <div un-bg="rose-100 emerald-100 rose-200 amber-200 emerald-200 rose-600 emerald-600 sky-50 hover:sky-100 rose-600 hover:rose-700 slate-700 hover:slate-800"
    un-text="emerald-600 rose-600 sky-600"
/>;