import { AnalysisChart } from '@/components/analysis/AnalysisChart'
import { OptionAnalysis } from '@/components/option/OptionAnalysis'
import { createFileRoute } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { SymbolSearch } from '../components/SymbolSearch'
import { fetchYahooData } from '../data/yahoo'

type AnalysisSearch = {
    symbol?: string
}

export const Route = createFileRoute('/analysis')({
    validateSearch: (search: Record<string, unknown>): AnalysisSearch => {
        return {
            symbol: typeof search.symbol === 'string' ? search.symbol : undefined,
        }
    },
    loaderDeps: ({ search: { symbol } }) => ({ symbol }),
    loader: async ({ deps: { symbol = '^SPX' } }) => {
        const interval = '1d'
        const range = '5y'
        try {
            const data = await fetchYahooData({ data: { symbol, interval, range } });
            return { data, symbol }
        } catch (error) {
            console.error("Failed to load data for", symbol, error)
            throw error
        }
    },
    component: RouteComponent,
    errorComponent: ErrorComponent,
})

function RouteComponent() {
    const { data, symbol } = Route.useLoaderData()

    return (
        <div un-flex="~ col gap-2" un-p="6">
            <SymbolSearch initialValue={symbol} />
            {/* <AnalysisChart key={symbol} data={data} /> */}
            <OptionAnalysis symbol={symbol} />
        </div>
    )
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
    const { symbol } = Route.useSearch()

    return (
        <div un-flex="~ col gap-4 items-center" un-my='16' >
            <header un-flex="~ items-center gap-2">
                <CircleAlert un-text="red-500" />
                <h2 un-text="xl slate-700" un-font="bold">{error.message}</h2>
            </header>

            <p un-text="slate-500">
                Could not fetch market data for <span un-font="mono font-bold">{symbol || '^SPX'}</span>.
                <br />
                Please check the symbol and try again.
            </p>

            <SymbolSearch initialValue={symbol} />

            <button
                onClick={reset}
                un-p="x-4 y-2"
                un-cursor="pointer"
                un-bg="slate-100 hover:slate-200"
                un-text="slate-700"
                un-rounded="lg"
            >
                Try Again
            </button>
        </div>
    )
}
