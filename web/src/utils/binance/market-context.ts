import { createServerFn } from '@tanstack/react-start';

export type MarketContext = {
    ticker: string;
    floorStrike: number;
    openTime: string;           // ISO string (UTC)
    openTimeMs: number;         // epoch ms
    closeTime: string;
    binanceOpenPrice: number;   // BTC close price at the Kalshi open_time from Binance
    strikeDistance: number;     // binanceOpenPrice - floorStrike (positive = price above strike)
};

/**
 * Fetches the Kalshi market metadata (floor_strike, open_time) and the
 * Binance BTCUSDT close price at that exact open_time.
 * Runs server-side to avoid CORS.
 */
export const fetchMarketContext = createServerFn({ method: 'GET' })
    .inputValidator((d: { ticker: string }) => d)
    .handler(async ({ data: { ticker } }): Promise<MarketContext | null> => {
        try {
            // 1. Fetch Kalshi market metadata
            console.log('[market-context] Fetching Kalshi market metadata for', ticker);
            const kalshiRes = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`);
            if (!kalshiRes.ok) {
                console.error('[market-context] Kalshi API returned', kalshiRes.status);
                return null;
            }
            const { market } = await kalshiRes.json();
            const floorStrike: number = market.floor_strike;
            const openTime: string = market.open_time;  // e.g. "2026-04-29T00:45:00Z"
            const closeTime: string = market.close_time;

            if (!floorStrike || !openTime) {
                console.error('[market-context] Missing floor_strike or open_time in Kalshi response');
                return null;
            }

            const openTimeMs = new Date(openTime).getTime();

            // 2. Fetch Binance BTCUSDT kline at the open_time
            //    We request a 1-minute kline starting at the open_time.
            //    The close price of that kline is the BTC price at market open.
            console.log('[market-context] Fetching Binance BTCUSDT kline at', openTimeMs);
            const host = process.env.BINANCE_API_HOST || 'api.binance.us';
            const binanceUrl = `https://${host}/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${openTimeMs}&limit=1`;
            const binanceRes = await fetch(binanceUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            let binanceOpenPrice = 0;
            if (binanceRes.ok) {
                const klines = await binanceRes.json();
                // Binance kline format: [openTime, open, high, low, close, volume, ...]
                if (klines.length > 0) {
                    // Use the open price of the kline that starts at open_time
                    // This is the BTC price at exactly the moment the Kalshi window opened
                    binanceOpenPrice = parseFloat(klines[0][1]); // index 1 = open price
                }
            } else {
                console.error('[market-context] Binance klines API returned', binanceRes.status);
            }

            const ctx: MarketContext = {
                ticker,
                floorStrike,
                openTime,
                openTimeMs,
                closeTime,
                binanceOpenPrice,
                strikeDistance: binanceOpenPrice - floorStrike,
            };

            console.log('[market-context]', ticker,
                'strike:', floorStrike,
                'openPrice:', binanceOpenPrice,
                'distance:', ctx.strikeDistance.toFixed(2));

            return ctx;
        } catch (err) {
            console.error('[market-context] Error:', err);
            return null;
        }
    });
