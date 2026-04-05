import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ORBDashboard } from '../components/orb/ORBDashboard'
import { fetchORBSummaries, fetchORBTrades } from '../data/orb'

type SearchParams = {
    startDate?: string
    endDate?: string
    symbol?: string
}

function defaultStartDate() {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
}

function defaultEndDate() {
    return new Date().toISOString().split('T')[0]
}

export const Route = createFileRoute('/bot/orb')({
    head: () => ({ meta: [{ title: 'ORB Trading Bot' }] }),
    validateSearch: (search: Record<string, unknown>): SearchParams => ({
        startDate: (search.startDate as string) || undefined,
        endDate: (search.endDate as string) || undefined,
        symbol: (search.symbol as string) || undefined,
    }),
    loaderDeps: ({ search }) => search,
    loader: async ({ deps }) => {
        const startDate = deps.startDate || defaultStartDate()
        const endDate = deps.endDate || defaultEndDate()
        const [trades, summaries] = await Promise.all([
            fetchORBTrades({ data: { startDate, endDate, symbol: deps.symbol } }),
            fetchORBSummaries({ data: { startDate, endDate } }),
        ])
        return { trades, summaries, startDate, endDate, symbol: deps.symbol || '' }
    },
    component: ORBPage,
})

function ORBPage() {
    const { trades, summaries, startDate, endDate, symbol } = Route.useLoaderData()
    const navigate = useNavigate()

    function onFilterChange(updates: { startDate?: string; endDate?: string; symbol?: string }) {
        navigate({
            to: '/bot/orb',
            search: (prev: SearchParams) => ({ ...prev, ...updates }),
        })
    }

    return (
        <div un-p="4">
            <h1 un-text="2xl slate-900" un-font="bold" un-mb="2">ORB Trading Bot</h1>
            <ORBDashboard
                trades={trades}
                summaries={summaries}
                startDate={startDate}
                endDate={endDate}
                symbol={symbol}
                onFilterChange={onFilterChange}
            />
        </div>
    )
}
