import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import UnoCSS from '@unocss/postcss';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import crypto from 'node:crypto';
import { defineConfig, loadEnv, type PluginOption } from 'vite-plus';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import { WebSocket as WSClient, WebSocketServer } from 'ws';

function kalshiWsRelay(env: Record<string, string>): PluginOption {
  const UPSTREAM_HOST = 'api.elections.kalshi.com';
  const UPSTREAM_PATH = '/trade-api/ws/v2';
  const UPSTREAM_URL = `wss://${UPSTREAM_HOST}${UPSTREAM_PATH}`;
  const CLIENT_PATH = '/api/kalshi-ws';

  const apiKeyId = env.KALSHI_API_KEY_ID;
  const pem = env.KALSHI_PRIVATE_KEY;

  const sign = () => {
    const ts = Date.now().toString();
    const msg = ts + 'GET' + UPSTREAM_PATH;
    const key = crypto.createPrivateKey({
      key: (pem || '').replace(/\\n/g, '\n'),
      format: 'pem',
    });
    const sig = crypto
      .sign('sha256', Buffer.from(msg), {
        key,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      })
      .toString('base64');
    return {
      'KALSHI-ACCESS-KEY': apiKeyId!,
      'KALSHI-ACCESS-TIMESTAMP': ts,
      'KALSHI-ACCESS-SIGNATURE': sig,
    };
  };

  return {
    name: 'kalshi-ws-relay',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url || !req.url.startsWith(CLIENT_PATH)) return;

        if (!apiKeyId || !pem) {
          console.error(
            '[kalshi-ws] Missing KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY (or VITE_KALSHI_*) in web/.env',
          );
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (client) => {
          console.log('[kalshi-ws] client connected → opening upstream');
          const headers = sign();
          const upstream = new WSClient(UPSTREAM_URL, { headers });

          // Buffer any client messages that arrive before upstream is OPEN.
          // The browser sends its `subscribe` command right after the relay
          // accepts its upgrade — which is usually *before* we've finished
          // the TLS handshake with Kalshi.
          const pending: { data: Buffer; isBinary: boolean; }[] = [];

          upstream.on('open', () => {
            console.log(`[kalshi-ws] upstream OPEN (flushing ${pending.length} buffered msg)`);
            for (const m of pending) upstream.send(m.data, { binary: m.isBinary });
            pending.length = 0;
          });
          upstream.on('unexpected-response', (_req, res) => {
            console.error(`[kalshi-ws] upstream REJECTED ${res.statusCode} ${res.statusMessage ?? ''}`);
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              if (body) console.error('[kalshi-ws] upstream body:', body);
              if (client.readyState === client.OPEN)
                client.close(1011, `upstream ${res.statusCode}`);
            });
          });
          upstream.on('error', (e) => console.error('[kalshi-ws] upstream error:', e));
          upstream.on('message', (data, isBinary) => {
            if (client.readyState !== client.OPEN) return;
            // Forward preserving frame type so browser gets a text frame
            // (JSON) when Kalshi sent text, not a binary Blob.
            const payload = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            client.send(payload, { binary: isBinary });
          });
          upstream.on('close', (code, reason) => {
            console.log(`[kalshi-ws] upstream closed ${code} ${reason.toString() || '(no reason)'}`);
            if (client.readyState === client.OPEN) client.close(code, reason.toString());
          });

          client.on('message', (data, isBinary) => {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            // Log subscribe/unsubscribe so you can see what the UI is asking for.
            if (!isBinary && buf.length < 2048) {
              try {
                const s = buf.toString('utf8');
                console.log('[kalshi-ws] → upstream:', s);
              } catch { /* ignore */ }
            }
            if (upstream.readyState === upstream.OPEN) {
              upstream.send(buf, { binary: isBinary });
            } else if (upstream.readyState === upstream.CONNECTING) {
              pending.push({ data: buf, isBinary });
            }
          });
          client.on('close', () => {
            if (upstream.readyState === upstream.OPEN) upstream.close();
          });
          client.on('error', () => {
            if (upstream.readyState === upstream.OPEN) upstream.close();
          });
        });
      });
    },
  };
}

function binanceWsRelay(): PluginOption {
  const BINANCE_STREAMS = [
    'btcusdt@aggTrade',
    'btcusdt@depth20@100ms',
    'btcusdt@bookTicker',
  ];
  // Try binance.us for US users; set BINANCE_WS_HOST in .env to override
  const host = process.env.BINANCE_WS_HOST || 'stream.binance.us:9443';
  const UPSTREAM_URL = `wss://${host}/stream?streams=${BINANCE_STREAMS.join('/')}`;
  const CLIENT_PATH = '/api/binance-ws';
  const AGG_INTERVAL_MS = 1000; // aggregate trades into 1-second buckets

  return {
    name: 'binance-ws-relay',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url || !req.url.startsWith(CLIENT_PATH)) return;

        wss.handleUpgrade(req, socket, head, (client) => {
          console.log('[binance-ws] client connected → opening upstream');
          const upstream = new WSClient(UPSTREAM_URL);

          // ── aggTrade 1-second bucketing ──────────────────────
          let bucket: {
            ts: number; open: number; high: number; low: number; close: number;
            volume: number; buyVolume: number; sellVolume: number;
            quoteVolume: number; buyQuoteVolume: number;
            tradeCount: number;
          } | null = null;
          let flushTimer: ReturnType<typeof setInterval> | null = null;
          let lastPrice = 0;

          const flushBucket = () => {
            if (client.readyState !== client.OPEN) return;
            if (!bucket) {
              if (lastPrice > 0) {
                client.send(JSON.stringify({
                  stream: 'btcusdt@aggTradeBucket',
                  data: {
                    ts: Date.now(),
                    open: lastPrice, high: lastPrice, low: lastPrice, close: lastPrice,
                    volume: 0, buyVolume: 0, sellVolume: 0,
                    quoteVolume: 0, buyQuoteVolume: 0, tradeCount: 0
                  }
                }));
              }
              return;
            }
            lastPrice = bucket.close;
            client.send(JSON.stringify({
              stream: 'btcusdt@aggTradeBucket',
              data: { ...bucket },
            }));
            bucket = null;
          };

          const addToBucket = (trade: any) => {
            const price = parseFloat(trade.p);
            const qty = parseFloat(trade.q);
            const quoteQty = price * qty;
            const isBuy = !trade.m; // m=true means buyer is market maker → seller-initiated
            const now = Date.now();

            if (!bucket) {
              bucket = {
                ts: now, open: price, high: price, low: price, close: price,
                volume: qty, buyVolume: isBuy ? qty : 0, sellVolume: isBuy ? 0 : qty,
                quoteVolume: quoteQty, buyQuoteVolume: isBuy ? quoteQty : 0,
                tradeCount: 1,
              };
            } else {
              bucket.high = Math.max(bucket.high, price);
              bucket.low = Math.min(bucket.low, price);
              bucket.close = price;
              bucket.volume += qty;
              bucket.quoteVolume += quoteQty;
              if (isBuy) {
                bucket.buyVolume += qty;
                bucket.buyQuoteVolume += quoteQty;
              } else {
                bucket.sellVolume += qty;
              }
              bucket.tradeCount++;
            }
          };

          upstream.on('open', () => {
            console.log('[binance-ws] upstream OPEN');
            // Start the 1-second flush timer
            flushTimer = setInterval(flushBucket, AGG_INTERVAL_MS);
          });

          upstream.on('message', (data, isBinary) => {
            if (client.readyState !== client.OPEN) return;
            try {
              const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
              const msg = JSON.parse(text);
              console.log('[binance-ws] → client:', msg);

              if (msg.stream === 'btcusdt@aggTrade') {
                // Buffer into 1-second bucket instead of forwarding each trade
                addToBucket(msg.data);
                return;
              }

              if (msg.stream === 'btcusdt@bookTicker' && lastPrice === 0) {
                const mid = (parseFloat(msg.data.b) + parseFloat(msg.data.a)) / 2;
                lastPrice = mid;
              }

              // Forward everything else as-is
              const payload = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
              client.send(payload, { binary: isBinary });
            } catch {
              // If parsing fails, forward raw
              const payload = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
              client.send(payload, { binary: isBinary });
            }
          });

          upstream.on('error', (e) => console.error('[binance-ws] upstream error:', e));
          upstream.on('unexpected-response', (_req: any, res: any) => {
            console.error(`[binance-ws] upstream REJECTED ${res.statusCode} ${res.statusMessage ?? ''}`);
            let body = '';
            res.on('data', (c: any) => (body += c));
            res.on('end', () => {
              if (body) console.error('[binance-ws] upstream body:', body);
              try { if (client.readyState === client.OPEN) client.close(1011, `upstream ${res.statusCode}`); } catch { /* noop */ }
            });
          });
          upstream.on('close', (code, reason) => {
            console.log(`[binance-ws] upstream closed ${code} ${reason?.toString() || '(no reason)'}`);
            if (flushTimer) clearInterval(flushTimer);
            flushBucket(); // flush remaining
            try {
              const safeCode = (code >= 1000 && code <= 4999 && code !== 1006) ? code : 1000;
              if (client.readyState === client.OPEN) client.close(safeCode, reason?.toString());
            } catch { /* noop */ }
          });

          client.on('close', () => {
            if (flushTimer) clearInterval(flushTimer);
            try { if (upstream.readyState === upstream.OPEN) upstream.close(); } catch { /* noop */ }
          });
          client.on('error', () => {
            if (flushTimer) clearInterval(flushTimer);
            try { if (upstream.readyState === upstream.OPEN) upstream.close(); } catch { /* noop */ }
          });
        });
      });
    },
  };
}

const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');

const config = defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  plugins: [
    devtools(),
    nitro(),
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart(),
    viteReact({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
    kalshiWsRelay(env),
    binanceWsRelay(),
  ],
  server: {
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  css: {
    postcss: {
      plugins: [
        UnoCSS(),
      ],
    },
  },
});

export default config;
