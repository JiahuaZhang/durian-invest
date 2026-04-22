// TS port of bot/strategies/kalshi_crypto/market_state.py :: get_current_15m_market_ticker
//
// Computes the Kalshi 15-minute market ticker for the current "rolling" window.
// All close times are encoded in Eastern time (America/New_York).

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

type ETParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
};

function etParts(date: Date): ETParts {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    const o: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') o[p.type] = p.value;
    const hour = Number(o.hour) === 24 ? 0 : Number(o.hour);
    return {
        year: Number(o.year),
        month: Number(o.month),
        day: Number(o.day),
        hour,
        minute: Number(o.minute),
        second: Number(o.second),
    };
}

export type KalshiTicker = {
    ticker: string;
    closeTs: number; // unix seconds
};

export function getCurrent15mMarketTicker(series: string, now: Date = new Date()): KalshiTicker {
    const et = etParts(now);
    // seconds remaining to the next 15-minute ET boundary
    const secToBoundary = (15 - (et.minute % 15)) * 60 - et.second;
    const closeDate = new Date(now.getTime() + secToBoundary * 1000);
    const c = etParts(closeDate);

    const yy = String(c.year % 100).padStart(2, '0');
    const mon = MONTHS[c.month - 1];
    const dd = String(c.day).padStart(2, '0');
    const hh = String(c.hour).padStart(2, '0');
    const mm = String(c.minute).padStart(2, '0');

    const ticker = `${series}-${yy}${mon}${dd}${hh}${mm}-${mm}`;
    return { ticker, closeTs: Math.floor(closeDate.getTime() / 1000) };
}

export function formatEt(date: Date): string {
    const p = etParts(date);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')} ET`;
}
