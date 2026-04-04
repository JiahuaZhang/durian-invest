import { createFileRoute } from '@tanstack/react-router'
import { RefreshCw, Search, Settings, Terminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Fragment, useState } from 'react'
import { fetchQSChain } from '../utils/quikstrike/chain'
import { QS_PRODUCTS } from '../utils/quikstrike/client'
import type { QSChainResult, QSStrikeRow } from '../utils/quikstrike/types'

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/option/cme')({
    head: () => ({ meta: [{ title: 'CME Futures Options — QuikStrike' }] }),
    component: CMEOptionPage,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | undefined, dec = 2) {
    if (n == null || n === 0) return '--'
    return n.toFixed(dec)
}

function fmtVol(v: number | undefined) {
    if (!v) return '--'
    return v.toFixed(2) + '%'
}

function fmtDelta(d: number | undefined) {
    if (d == null || d === 0) return '--'
    return (d >= 0 ? '+' : '') + d.toFixed(3)
}

function fmtChg(n: number | undefined) {
    if (n == null || n === 0) return '--'
    return (n >= 0 ? '+' : '') + n.toFixed(2)
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function CMEOptionPage() {
    const [cookies, setCookies] = useState('')
    const [showSetup, setShowSetup] = useState(true)
    const [selectedProduct, setProduct] = useState(QS_PRODUCTS[0])
    const [optionSeries, setOptionSeries] = useState('')

    const [chain, setChain] = useState<QSChainResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showRaw, setShowRaw] = useState(false)
    const [hideOTMBelow, setHideOTMBelow] = useState(0)

    const cookiesSet = cookies.trim().length > 10

    async function loadChain() {
        if (!cookiesSet || !optionSeries.trim()) return
        setLoading(true)
        setError(null)
        setChain(null)
        try {
            const data = await fetchQSChain({
                data: {
                    cookies,
                    optionSeries: optionSeries.trim(),
                    pid: selectedProduct.pid,
                    pf: selectedProduct.pf,
                },
            })
            setChain(data)
            if (showSetup) setShowSetup(false)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div un-flex="~ col" un-h="full" un-overflow="hidden">
            {/* ── Header ── */}
            <div un-flex="~ items-center gap-3 wrap" un-p="x-4 y-2.5" un-border="b slate-200">
                <div un-flex="~ items-center gap-2">
                    <h1 un-text="lg slate-800" un-font="bold">CME Futures Options</h1>
                    <span un-text="xs slate-500 bg-slate-100" un-p="x-1.5 y-0.5" un-rounded="md">QuikStrike</span>
                </div>

                {chain && (
                    <div un-flex="~ items-center gap-4" un-ml="2">
                        <div un-flex="~ col">
                            <span un-text="xs slate-400">Futures</span>
                            <span un-font="mono semibold" un-text="sm slate-800">
                                {chain.futuresCode || chain.product}
                                {' '}
                                {chain.futuresPrice > 0 ? chain.futuresPrice.toFixed(1) : '--'}
                                {chain.futuresChange !== 0 && (
                                    <span un-text={chain.futuresChange >= 0 ? 'emerald-600 xs' : 'red-500 xs'} un-ml="1">
                                        {fmtChg(chain.futuresChange)}
                                    </span>
                                )}
                            </span>
                        </div>
                        <div un-flex="~ col">
                            <span un-text="xs slate-400">ATM IV</span>
                            <span un-font="mono semibold" un-text="sm slate-700">{fmtVol(chain.iv)}</span>
                        </div>
                        <div un-flex="~ col">
                            <span un-text="xs slate-400">DTE</span>
                            <span un-font="mono semibold" un-text="sm slate-700">{chain.dte > 0 ? chain.dte.toFixed(1) + 'd' : '--'}</span>
                        </div>
                    </div>
                )}

                <div un-flex="~ items-center gap-2" un-ml="auto">
                    <button
                        onClick={() => setShowSetup(v => !v)}
                        un-flex="~ items-center gap-1" un-p="x-2.5 y-1.5" un-text="xs slate-600"
                        un-border="~ slate-200 rounded-lg" un-bg="hover:slate-50" un-cursor="pointer"
                        un-transition="colors"
                    >
                        <Settings size={13} />
                        {showSetup ? 'Hide Setup' : 'Setup'}
                        {!cookiesSet && <span un-w="1.5" un-h="1.5" un-rounded="full" un-bg="amber-400" un-ml="0.5" />}
                    </button>

                    {chain && (
                        <button
                            onClick={() => setShowRaw(v => !v)}
                            un-flex="~ items-center gap-1" un-p="x-2.5 y-1.5" un-text="xs slate-500"
                            un-border="~ slate-200 rounded-lg" un-bg="hover:slate-50" un-cursor="pointer"
                        >
                            <Terminal size={13} />
                            Raw
                        </button>
                    )}
                </div>
            </div>

            {/* ── Setup panel ── */}
            {showSetup && (
                <SetupPanel
                    cookies={cookies}
                    onCookiesChange={setCookies}
                    selectedProduct={selectedProduct}
                    onProductChange={setProduct}
                    optionSeries={optionSeries}
                    onOptionSeriesChange={setOptionSeries}
                    onLoad={loadChain}
                    loading={loading}
                />
            )}

            {/* ── Error ── */}
            {error && (
                <div un-p="3 x-4" un-bg="red-50" un-text="red-700 xs" un-border="b red-200" un-whitespace="pre-wrap">
                    {error}
                </div>
            )}

            {/* ── Loading ── */}
            {loading && (
                <div un-flex="~ col items-center justify-center grow-1 gap-3">
                    <div un-w="10" un-h="10" un-border="4 blue-500 t-transparent rounded-full" un-animate="spin" />
                    <p un-text="slate-500 sm">Fetching from QuikStrike...</p>
                </div>
            )}

            {/* ── Empty state ── */}
            {!chain && !loading && !error && (
                <div un-flex="~ col items-center justify-center grow-1 gap-3" un-text="slate-400">
                    <Search size={48} un-opacity="15" />
                    <div un-text="center sm">
                        <p un-font="semibold" un-text="slate-600">CME Futures Options Chain</p>
                        <p un-text="xs slate-400 mt-1">
                            Paste your QuikStrike session cookies, enter an option series code, then click Load
                        </p>
                    </div>
                </div>
            )}

            {/* ── Chain ── */}
            {chain && !loading && (
                <div un-flex="~ col 1" un-overflow="hidden">
                    {showRaw ? (
                        <RawView raw={chain._raw} endpoint={chain._endpoint} />
                    ) : (
                        <>
                            <ChainToolbar chain={chain} hideBelow={hideOTMBelow} onHideBelowChange={setHideOTMBelow} />
                            <OptionChainTable chain={chain} hideOTMBelow={hideOTMBelow} />
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Setup Panel ───────────────────────────────────────────────────────────────

type SetupPanelProps = {
    cookies: string
    onCookiesChange: (v: string) => void
    selectedProduct: typeof QS_PRODUCTS[0]
    onProductChange: (v: typeof QS_PRODUCTS[0]) => void
    optionSeries: string
    onOptionSeriesChange: (v: string) => void
    onLoad: () => void
    loading: boolean
}

function SetupPanel(props: SetupPanelProps) {
    const [showGuide, setShowGuide] = useState(false)

    return (
        <div un-border="b slate-200" un-bg="slate-50/50" un-p="x-4 y-3">
            <div un-flex="~ gap-6 wrap">
                {/* Cookies */}
                <div un-flex="~ col gap-1.5 grow-1">
                    <div un-flex="~ items-center gap-2">
                        <label un-text="xs slate-600" un-font="semibold">QuikStrike Session Cookies</label>
                        <button
                            onClick={() => setShowGuide(v => !v)}
                            un-text="xs blue-500 hover:blue-700 underline" un-cursor="pointer"
                        >
                            {showGuide ? 'hide guide' : 'how to get?'}
                        </button>
                    </div>

                    {showGuide && (
                        <div un-bg="blue-50" un-border="~ blue-200 rounded-lg" un-p="3" un-text="xs blue-800">
                            <p un-font="semibold" un-mb="1">Chrome DevTools - copy cookies:</p>
                            <ol un-p="l">
                                <li>Open <a href="https://cmegroup-sso.quikstrike.net" target="_blank">cmegroup-sso.quikstrike.net</a> in Chrome (logged in)</li>
                                <li>Press <kbd un-bg="white" un-border="~ blue-200 rounded" un-px="1">F12</kbd> → Application → Cookies</li>
                                <li>Or: Network tab → click any request → find <span un-font="mono">Cookie:</span> header</li>
                                <li>Copy the full cookie string and paste below</li>
                            </ol>
                        </div>
                    )}

                    <textarea
                        value={props.cookies}
                        onChange={e => props.onCookiesChange(e.target.value)}
                        placeholder=".ASPXAUTH=...; ASP.NET_SessionId=...; (paste full cookie string)"
                        un-border="~ slate-300 rounded-lg" un-p="x-3 y-2" un-text="xs" un-font="mono"
                        un-outline="focus:blue-400" un-resize="y" un-h="30" un-w="full"
                    />
                </div>

                {/* Product + Option Series */}
                <div un-flex="~ col gap-3">
                    {/* Product selector */}
                    <div un-flex="~ col gap-1">
                        <label un-text="xs slate-600" un-font="semibold">Product</label>
                        <select
                            value={props.selectedProduct.optRoot}
                            onChange={e => {
                                const p = QS_PRODUCTS.find(p => p.optRoot === e.target.value)
                                if (p) props.onProductChange(p)
                            }}
                            un-border="~ slate-300 rounded-lg" un-p="x-3 y-1.5" un-text="sm"
                            un-outline="focus:blue-400" un-bg="white"
                        >
                            {QS_PRODUCTS.map(p => (
                                <option key={p.optRoot} value={p.optRoot}>{p.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Option Series */}
                    <div un-flex="~ col gap-1">
                        <label un-text="xs slate-600" un-font="semibold">Option Series Code</label>
                        <input
                            type="text"
                            value={props.optionSeries}
                            onChange={e => props.onOptionSeriesChange(e.target.value.toUpperCase())}
                            placeholder={`e.g. ${props.selectedProduct.optRoot}K6, ${props.selectedProduct.optRoot}M6`}
                            un-border="~ slate-300 rounded-lg" un-p="x-3 y-1.5" un-text="sm" un-font="mono"
                            un-outline="focus:blue-400" un-w="full"
                        />
                        <span un-text="xs slate-400">
                            Find codes on QuikStrike expiry tabs (e.g. OGK6 = May Gold, G1RJ6 = weekly)
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div un-flex="~ col gap-2 justify-end">
                    <button
                        onClick={props.onLoad}
                        disabled={props.loading || !props.cookies.trim() || !props.optionSeries.trim()}
                        un-flex="~ items-center gap-1.5" un-p="x-4 y-2" un-text="sm white"
                        un-bg="blue-600 hover:blue-700 disabled:blue-300"
                        un-border="rounded-lg" un-cursor="pointer disabled:cursor-not-allowed"
                        un-transition="colors"
                    >
                        {props.loading
                            ? <><RefreshCw size={13} un-animate="spin" />Loading...</>
                            : <><Search size={13} />Load Chain</>}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── Chain Toolbar ─────────────────────────────────────────────────────────────

function ChainToolbar({ chain, hideBelow, onHideBelowChange }: {
    chain: QSChainResult
    hideBelow: number
    onHideBelowChange: (v: number) => void
}) {
    return (
        <div un-flex="~ items-center gap-4 wrap" un-p="x-4 y-2" un-border="b slate-200" un-bg="slate-50/30" un-text="xs">
            <div un-flex="~ items-center gap-1">
                <span un-text="slate-400">Series:</span>
                <span un-font="mono semibold" un-text="slate-700">{chain.expiry}</span>
            </div>
            {chain.dte > 0 && (
                <div un-flex="~ items-center gap-1">
                    <span un-text="slate-400">DTE:</span>
                    <span un-font="mono" un-text={chain.dte <= 3 ? 'red-600' : chain.dte <= 14 ? 'amber-600' : 'slate-700'}>
                        {chain.dte}d
                    </span>
                </div>
            )}
            <div un-flex="~ items-center gap-1">
                <span un-text="slate-400">Strikes:</span>
                <span un-font="mono" un-text="slate-700">{chain.strikes.length}</span>
            </div>
            <div un-flex="~ items-center gap-2" un-ml="auto">
                <span un-text="slate-400">Hide low-OI strikes (OI &lt;):</span>
                <input
                    type="number" min={0} step={1} value={hideBelow}
                    onChange={e => onHideBelowChange(parseInt(e.target.value) || 0)}
                    un-border="~ slate-200 rounded" un-p="x-2 y-0.5" un-text="xs" un-font="mono" un-w="16"
                    un-outline="focus:blue-400"
                />
            </div>
        </div>
    )
}

// ── Options Chain Table ───────────────────────────────────────────────────────

function OptionChainTable({ chain, hideOTMBelow }: {
    chain: QSChainResult
    hideOTMBelow: number
}) {
    const futPrice = chain.futuresPrice

    const atmStrike = chain.strikes.reduce<number | null>((best, row) => {
        if (!futPrice) return best
        if (best === null) return row.strike
        return Math.abs(row.strike - futPrice) < Math.abs(best - futPrice) ? row.strike : best
    }, null)

    const hasAnyBidAsk = chain.strikes.some(
        r => r.call?.bid != null || r.put?.bid != null,
    )
    const hasTheta = chain.strikes.some(r => r.call?.theta != null || r.put?.theta != null)
    const hasGreeks = chain.strikes.some(r => r.call?.gamma != null || r.put?.gamma != null)

    const rows = hideOTMBelow > 0
        ? chain.strikes.filter(r => {
            const callOI = r.call?.oi ?? 0
            const putOI = r.put?.oi ?? 0
            return callOI >= hideOTMBelow || putOI >= hideOTMBelow
        })
        : chain.strikes

    const callCols = 5 + (hasAnyBidAsk ? 2 : 0) + (hasTheta ? 1 : 0) + (hasGreeks ? 1 : 0)
    const putCols = 5 + (hasAnyBidAsk ? 2 : 0) + (hasTheta ? 1 : 0) + (hasGreeks ? 1 : 0)

    return (
        <div un-flex="~ col 1" un-overflow="auto">
            <table un-border-collapse="collapse" un-text="xs" un-w="full">
                <thead un-position="sticky" un-top="0" un-z="10">
                    <tr un-bg="slate-50">
                        <th colSpan={callCols}
                            un-p="x-3 y-1.5" un-text="emerald-600" un-font="semibold"
                            un-border="b r slate-200">
                            CALLS
                        </th>
                        <th un-p="x-3 y-1.5" un-text="center slate-600" un-font="semibold" un-bg="slate-100" un-border="b slate-200">
                            STRIKE
                        </th>
                        <th colSpan={putCols}
                            un-p="x-3 y-1.5" un-text="red-500" un-font="semibold"
                            un-border="b l slate-200">
                            PUTS
                        </th>
                    </tr>
                    <tr un-bg="slate-50">
                        {hasAnyBidAsk && <CallTH>Bid</CallTH>}
                        {hasAnyBidAsk && <CallTH>Ask</CallTH>}
                        <CallTH>Delta</CallTH>
                        {hasTheta && <CallTH>Theta</CallTH>}
                        {hasGreeks && <CallTH>Gamma</CallTH>}
                        <CallTH>Prem</CallTH>
                        <CallTH>IV</CallTH>
                        <CallTH>Vol</CallTH>
                        <CallTH border>OI</CallTH>
                        <th un-p="x-3 y-1.5" un-text="center slate-500" un-bg="slate-100" un-border="b slate-200">
                            Strike
                        </th>
                        <PutTH border>OI</PutTH>
                        <PutTH>Vol</PutTH>
                        <PutTH>IV</PutTH>
                        <PutTH>Prem</PutTH>
                        {hasGreeks && <PutTH>Gamma</PutTH>}
                        {hasTheta && <PutTH>Theta</PutTH>}
                        <PutTH>Delta</PutTH>
                        {hasAnyBidAsk && <PutTH>Ask</PutTH>}
                        {hasAnyBidAsk && <PutTH>Bid</PutTH>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => {
                        const isATM = atmStrike !== null && row.strike === atmStrike
                        const isCallITM = futPrice > 0 && row.strike < futPrice
                        const isPutITM = futPrice > 0 && row.strike > futPrice

                        const insertPriceSep =
                            futPrice > 0 &&
                            atmStrike !== null &&
                            row.strike === atmStrike

                        return (
                            <Fragment key={row.strike}>
                                {insertPriceSep && futPrice > 0 && (
                                    <tr>
                                        <td colSpan={99}
                                            un-p="x-3 y-0.5" un-bg="slate-800" un-text="white semibold center xs" un-font="mono">
                                            {chain.futuresCode || chain.product} @ {chain.futuresPrice.toFixed(1)}
                                            {chain.futuresChange !== 0 && (
                                                <span un-text={chain.futuresChange >= 0 ? 'emerald-400' : 'red-400'} un-ml="2">
                                                    {fmtChg(chain.futuresChange)}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                )}
                                <StrikeRow
                                    row={row}
                                    isATM={isATM}
                                    isCallITM={isCallITM}
                                    isPutITM={isPutITM}
                                    hasAnyBidAsk={hasAnyBidAsk}
                                    hasTheta={hasTheta}
                                    hasGreeks={hasGreeks}
                                />
                            </Fragment>
                        )
                    })}
                </tbody>
            </table>
            {rows.length === 0 && (
                <div un-p="8" un-text="center slate-400 sm">No option data available for this series.</div>
            )}
        </div>
    )
}

function CallTH({ children, right, border }: { children?: ReactNode; right?: boolean; border?: boolean }) {
    return (
        <th un-p="x-2.5 y-1.5"
            un-text={right ? 'right slate-400' : 'slate-400'}
            un-border={border ? 'b r slate-200' : 'b slate-200'}>
            {children}
        </th>
    )
}

function PutTH({ children, border }: { children?: ReactNode; border?: boolean }) {
    return (
        <th un-p="x-2.5 y-1.5"
            un-text="slate-400"
            un-border={border ? 'b l slate-200' : 'b slate-200'}>
            {children}
        </th>
    )
}

// ── Strike Row ────────────────────────────────────────────────────────────────

function StrikeRow({ row, isATM, isCallITM, isPutITM, hasAnyBidAsk, hasTheta, hasGreeks }: {
    row: QSStrikeRow
    isATM: boolean
    isCallITM: boolean
    isPutITM: boolean
    hasAnyBidAsk: boolean
    hasTheta: boolean
    hasGreeks: boolean
}) {
    const { call, put, strike } = row
    const strikeStr = strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(1)

    const callBg = isATM ? 'blue-50' : isCallITM ? 'emerald-50/40' : ''
    const putBg = isATM ? 'blue-50' : isPutITM ? 'red-50/40' : ''
    console.log(call)


    return (
        <tr un-border="b slate-100" un-transition="colors" un-bg="hover:slate-50/60">
            {hasAnyBidAsk && <Num v={call?.bid} green bg={callBg} />}
            {hasAnyBidAsk && <Num v={call?.ask} red bg={callBg} />}
            <DeltaCell v={call?.delta} side="call" bg={callBg} />
            {hasTheta && <Num v={call?.theta} fmt={v => fmt(v, 4)} bg={callBg} />}
            {hasGreeks && <Num v={call?.gamma} fmt={v => fmt(v, 4)} bg={callBg} />}
            <Num v={call?.prem} green bold bg={callBg} />
            <Num v={call?.vol} fmt={fmtVol} bg={callBg} />
            <OIVolCell v={call?.volume} right border bg={callBg} />
            <OIVolCell v={call?.oi} right border bg={callBg} />

            <td un-p="x-3 y-1.5" un-bg={isATM ? 'blue-100' : 'slate-50'}
                un-text={`center ${isATM ? 'semibold blue-800' : 'slate-700'}`}
                un-font="mono" un-border="r slate-200">
                {strikeStr}
            </td>

            <OIVolCell v={put?.oi} border bg={putBg} />
            <OIVolCell v={put?.volume} border bg={putBg} />
            <Num v={put?.vol} fmt={fmtVol} bg={putBg} />
            <Num v={put?.prem} red bold bg={putBg} />
            {hasGreeks && <Num v={put?.gamma} fmt={v => fmt(v, 4)} bg={putBg} />}
            {hasTheta && <Num v={put?.theta} fmt={v => fmt(v, 4)} bg={putBg} />}
            <DeltaCell v={put?.delta} side="put" bg={putBg} />
            {hasAnyBidAsk && <Num v={put?.ask} red bg={putBg} />}
            {hasAnyBidAsk && <Num v={put?.bid} green bg={putBg} />}
        </tr>
    )
}

function Num({ v, green, red, bold, fmt: fmtFn, bg = '' }: {
    v?: number; green?: boolean; red?: boolean; bold?: boolean; fmt?: (n: number) => string; bg?: string
}) {
    const display = v != null && v !== 0 ? (fmtFn ? fmtFn(v) : v.toFixed(2)) : '--'
    const empty = display === '--'
    const color = empty ? 'slate-300' : green ? 'emerald-600' : red ? 'red-500' : 'slate-600'
    return (
        <td un-p="x-2.5 y-1.5" un-font="mono"
            un-text={`right ${color} ${bold && !empty ? 'semibold' : ''}`}
            un-bg={bg}>
            {display}
        </td>
    )
}

function DeltaCell({ v, side, bg = '' }: { v?: number; side: 'call' | 'put'; bg?: string }) {
    const display = v != null && v !== 0 ? fmtDelta(v) : '--'
    const color = display === '--' ? 'slate-300'
        : side === 'call' ? 'emerald-600' : 'red-500'
    return (
        <td un-p="x-2.5 y-1.5" un-font="mono" un-text={`right ${color}`} un-bg={bg}>
            {display}
        </td>
    )
}

function OIVolCell({ v, right, border, bg }: {
    v?: number; right?: boolean; border?: boolean; bg?: string
}) {
    return (
        <td un-p="x-2.5 y-1.5" un-font="mono"
            un-text={`${right ? 'right' : ''} ${v === 0 ? 'slate-300' : 'slate-500'}`}
            un-border={border ? 'l slate-200' : ''}
            un-bg={bg || ''}>
            {v}
        </td>
    )
}

// ── Raw JSON Viewer ───────────────────────────────────────────────────────────

function RawView({ raw, endpoint }: { raw: unknown; endpoint?: string }) {
    return (
        <div un-flex="~ col 1" un-overflow="auto" un-bg="slate-950" un-p="4">
            {endpoint && (
                <div un-text="slate-400 xs" un-font="mono">
                    {endpoint}
                </div>
            )}
            <pre un-text="emerald-300 xs" un-font="mono" un-overflow="auto">
                {JSON.stringify(raw, null, 2)}
            </pre>
        </div>
    )
}

// UnoCSS safelist
export const _UnoSafelist = (
    <div
        un-bg="blue-50 blue-100 emerald-50 red-50 slate-50 slate-100 slate-800 slate-950"
        un-text="emerald-300 emerald-400 emerald-600 emerald-700 red-400 red-500 blue-500 blue-600 blue-800 amber-600 slate-300 slate-400 slate-500 slate-600 slate-700 slate-800 white"
        un-border="b r l slate-100 slate-200 blue-200 emerald-200"
    />
)
