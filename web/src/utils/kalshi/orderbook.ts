// Order book state + event replay helpers for Kalshi orderbook_delta channel.

export type Side = 'yes' | 'no';

// Raw message shapes on the wire (stringified decimals).
export type SnapshotMsg = {
    market_ticker: string;
    market_id: string;
    yes_dollars_fp: [string, string][];
    no_dollars_fp: [string, string][];
};

export type DeltaMsg = {
    market_ticker: string;
    market_id: string;
    price_dollars: string;
    delta_fp: string;
    side: Side;
    ts?: string;
};

// Recorded event (snapshot or delta) with a local arrival timestamp.
export type RecordedEvent =
    | { recvTs: number; seq?: number; type: 'snapshot'; data: SnapshotMsg; }
    | { recvTs: number; seq?: number; type: 'delta'; data: DeltaMsg; };

export type Recording = {
    // Stable ID so we can cite recordings in the UI.
    id: string;
    market_ticker: string;
    market_id: string;
    startedAt: number;
    events: RecordedEvent[];
};

export type Levels = Map<string, number>; // price-string → size (dollars, float)

export type BookState = {
    market_ticker: string;
    market_id: string;
    yes: Levels;
    no: Levels;
    lastEventTs: number | null;
};

const ZERO_EPS = 1e-9;

export function emptyBook(): BookState {
    return { market_ticker: '', market_id: '', yes: new Map(), no: new Map(), lastEventTs: null };
}

function ingestLevels(entries: [string, string][]): Levels {
    const m: Levels = new Map();
    for (const [p, q] of entries) {
        const qty = parseFloat(q);
        if (!Number.isFinite(qty) || qty <= ZERO_EPS) continue;
        m.set(p, qty);
    }
    return m;
}

export function applySnapshot(s: SnapshotMsg, recvTs: number): BookState {
    return {
        market_ticker: s.market_ticker,
        market_id: s.market_id,
        yes: ingestLevels(s.yes_dollars_fp),
        no: ingestLevels(s.no_dollars_fp),
        lastEventTs: recvTs,
    };
}

export function applyDelta(state: BookState, d: DeltaMsg, recvTs: number): BookState {
    const side = d.side === 'yes' ? state.yes : state.no;
    const next = new Map(side);
    const cur = next.get(d.price_dollars) ?? 0;
    const delta = parseFloat(d.delta_fp);
    const updated = cur + delta;
    if (updated <= ZERO_EPS) next.delete(d.price_dollars);
    else next.set(d.price_dollars, updated);
    return {
        ...state,
        yes: d.side === 'yes' ? next : state.yes,
        no: d.side === 'no' ? next : state.no,
        lastEventTs: recvTs,
    };
}

// Rebuild a book state by folding events from the last snapshot up to `upToIndex`.
export function rebuildAt(events: RecordedEvent[], upToIndex: number): BookState | null {
    if (events.length === 0 || upToIndex < 0) return null;
    let i = Math.min(upToIndex, events.length - 1);
    // Walk back to the most recent snapshot (inclusive).
    let startIdx = -1;
    for (let j = i; j >= 0; j--) {
        if (events[j].type === 'snapshot') {
            startIdx = j;
            break;
        }
    }
    if (startIdx === -1) return null;
    const snap = events[startIdx];
    if (snap.type !== 'snapshot') return null;
    let state = applySnapshot(snap.data, snap.recvTs);
    for (let j = startIdx + 1; j <= i; j++) {
        const e = events[j];
        if (e.type === 'delta') state = applyDelta(state, e.data, e.recvTs);
        else state = applySnapshot(e.data, e.recvTs);
    }
    return state;
}

// ── Derived views ─────────────────────────────────────────────────────────

export type Level = { price: number; size: number; };

export function sortedLevels(levels: Levels, desc = true): Level[] {
    const out: Level[] = [];
    for (const [p, s] of levels) out.push({ price: parseFloat(p), size: s });
    out.sort((a, b) => (desc ? b.price - a.price : a.price - b.price));
    return out;
}

export function bestBid(levels: Levels): Level | null {
    let best: Level | null = null;
    for (const [p, s] of levels) {
        const price = parseFloat(p);
        if (!best || price > best.price) best = { price, size: s };
    }
    return best;
}

// For a YES-market trader, the "ask" (price to buy YES) is derived from the
// best NO bid: ask_yes = 1 - best_no_bid. Returns a synthetic ask ladder.
export function impliedYesAsksFromNo(noLevels: Levels): Level[] {
    const out: Level[] = [];
    for (const [p, s] of noLevels) {
        const noPrice = parseFloat(p);
        out.push({ price: +(1 - noPrice).toFixed(4), size: s });
    }
    out.sort((a, b) => a.price - b.price); // ascending asks
    return out;
}

export function cumulativeDepth(levels: Level[]): { price: number; cum: number; }[] {
    let running = 0;
    return levels.map((l) => {
        running += l.size;
        return { price: l.price, cum: running };
    });
}

export function totalSize(levels: Levels): number {
    let t = 0;
    for (const v of levels.values()) t += v;
    return t;
}
