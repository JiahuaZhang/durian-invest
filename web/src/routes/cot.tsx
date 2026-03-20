import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Info, LayoutDashboard } from 'lucide-react'
import { PhysicalTFFChart, type RawPhysicalData } from '../components/PhysicalTFFChart'
import { TFFChart, type RawTFFData } from '../components/TFFChart'
import {
    CFTC_ENDPOINTS,
    DEFAULT_PRODUCT,
    getCategoriesForType,
    getProduct,
    getProductsByType,
    REPORT_TYPES,
    type ReportType,
} from '../config/cot-products'

type SearchParams = {
    type: ReportType
    product: string
}

export const Route = createFileRoute('/cot')({
    validateSearch: (search: Record<string, unknown>): SearchParams => {
        const type: ReportType = search.type === 'tff' ? 'tff' : 'disaggregated'
        const productKey = String(search.product ?? '')
        const product = getProduct(productKey, type) ? productKey : DEFAULT_PRODUCT[type]
        return { type, product }
    },
    loaderDeps: ({ search }) => ({ type: search.type, product: search.product }),
    loader: async ({ deps: { type, product } }) => {
        const config = getProduct(product, type)
        if (!config) throw new Error(`Unknown product: ${product}`)
        const url = `${CFTC_ENDPOINTS[type]}?cftc_contract_market_code=${encodeURIComponent(config.contractCode)}&$order=report_date_as_yyyy_mm_dd ASC&$limit=520`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Failed to fetch COT data for ${config.label}`)
        return { data: await res.json() }
    },
    component: CotIndexPage,
})

function CotIndexPage() {
    const navigate = useNavigate({ from: '/cot' })
    const { type, product } = Route.useSearch()
    const { data } = Route.useLoaderData()

    const handleTypeChange = (newType: ReportType) => {
        navigate({ search: { type: newType, product: DEFAULT_PRODUCT[newType] } })
    }

    const handleProductChange = (newProduct: string) => {
        navigate({ search: { type, product: newProduct } })
    }

    return (
        <div un-flex="~ col">

            <div un-flex="~ items-center gap-3" un-p="x-4 y-2" un-border="b slate-200">
                <div un-flex="~ items-center gap-2">
                    <LayoutDashboard size={16} un-text="slate-500" />
                    <span un-font="semibold" un-text="slate-700 sm">COT Reports</span>
                </div>

                <div un-w="px" un-h="4" un-bg="slate-200" />

                <div un-flex="~ gap-1" un-bg="slate-100" un-rounded="lg" un-p="1">
                    {REPORT_TYPES.map(rt => (
                        <button
                            key={rt.key}
                            onClick={() => handleTypeChange(rt.key)}
                            un-cursor="pointer"
                            un-p="x-3 y-1" un-rounded="md"
                            un-bg={type === rt.key ? 'white' : 'transparent'}
                            un-text={`sm ${type === rt.key ? 'slate-700' : 'slate-500'}`}
                            un-font={type === rt.key ? 600 : 400}
                            un-shadow={type === rt.key ? 'sm' : 'none'}
                        >
                            {rt.label}
                        </button>
                    ))}
                </div>

                <div un-w="px" un-h="4" un-bg="slate-200" />

                <select
                    value={product}
                    onChange={e => handleProductChange(e.target.value)}
                    un-border="~ slate-300 rounded-lg"
                    un-p="x-2 y-1" un-text="sm slate-700"
                    un-cursor="pointer"
                >
                    {getCategoriesForType(type).map(cat => (
                        <optgroup key={cat} label={cat}>
                            {getProductsByType(type)
                                .filter(p => p.category === cat)
                                .map(p => (
                                    <option key={p.key} value={p.key}>
                                        {p.label} ({p.ticker})
                                    </option>
                                ))}
                        </optgroup>
                    ))}
                </select>
            </div>

            <div un-flex="~ col gap-4" un-p="4">
                {type === 'disaggregated'
                    ? <PhysicalTFFChart data={data as RawPhysicalData[]} />
                    : <TFFChart data={data as RawTFFData[]} />
                }
                {type === 'disaggregated' ? <DisaggregatedGuide /> : <TFFGuide />}
            </div>

        </div>
    )
}

function DisaggregatedGuide() {
    return (
        <div un-bg="yellow-50" un-p="4" un-rounded="xl" un-flex="~ wrap gap-2" un-text="yellow-800 sm">
            <div un-flex="~ gap-2 items-center">
                <Info size={20} />
                <strong>Interpretation Guide — Disaggregated (Physical Commodities):</strong>
            </div>
            <div>
                <ul un-list="disc inside" un-space-y="1">
                    <li><strong>Producers/Merchants (Blue):</strong> Miners, refiners, farmers — direct physical exposure. "Smart Money" with superior supply/demand visibility. Heavy net-short = active hedging; reducing shorts = bullish signal.</li>
                    <li><strong>Managed Money (Green):</strong> Hedge funds and CTAs — trend-followers. Primary sentiment gauge. Extreme net longs = crowded trade; extreme net shorts = potential short-squeeze.</li>
                    <li><strong>Swap Dealers (Red):</strong> OTC swap intermediaries, often counterparties to Managed Money. Positions reflect swap-book hedging, not directional bets.</li>
                    <li><strong>Other Reportables (Gray):</strong> Smaller commercial and non-commercial traders. Useful for broad confirmation.</li>
                </ul>
                <p un-mt="2" un-font="semibold">Key signal: Managed Money at multi-year extremes + Producers reducing shorts = strongest bullish setup.</p>
            </div>
        </div>
    )
}

function TFFGuide() {
    return (
        <div un-bg="blue-50" un-p="4" un-rounded="xl" un-text="blue-800 sm">
            <div un-flex="~ gap-2 items-center">
                <Info size={20} />
                <strong>Interpretation Guide — Traders in Financial Futures (TFF):</strong>
            </div>
            <ul un-list="disc inside" un-space-y="1">
                <li><strong>Asset Managers (Blue):</strong> Pension funds, mutual funds — "Real Money." Structurally long-biased, move slowly over months/quarters. Extremes mark major trend shifts.</li>
                <li><strong>Leveraged Funds (Green):</strong> Hedge funds, CTAs — "Fast Money." Heavily trend-following, use leverage aggressively. Most actionable for timing. Extremes = crowded trade, watch for reversal.</li>
                <li><strong>Dealers (Red):</strong> Sell-side banks. Facilitate client flow and delta-hedge OTC books. Structural hedges — not directionally informative on their own.</li>
                <li><strong>Other Reportables (Gray):</strong> Smaller speculators. Often "dumb money" — contrarian indicator at extremes.</li>
            </ul>
            <p un-mt="2" un-font="semibold">Key signal: Leveraged Funds at multi-year extremes = trend exhaustion. AM/LF divergence = structural vs. speculative imbalance.</p>
        </div>
    )
}
