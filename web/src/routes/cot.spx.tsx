import { createFileRoute } from '@tanstack/react-router'
import { Info } from 'lucide-react'
import { TFFChart } from '../components/TFFChart'

const URL = "https://publicreporting.cftc.gov/resource/yw9f-hn96.json?cftc_contract_market_code=13874%2B&$order=report_date_as_yyyy_mm_dd ASC"

export const Route = createFileRoute('/cot/spx')({
  loader: async () => {
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`Failed to fetch TFF data`)

    return { financialData: await res.json() }
  },
  component: CotPage
})

function CotPage() {
  const { financialData } = Route.useLoaderData()

  return (
    <div un-p="2" un-flex="~ col" un-gap="2" un-h="full">
      <TFFChart data={financialData} />

      <div un-bg="blue-50" un-p="4" un-rounded="xl" un-text="blue-800 text-sm">
        <header un-flex='~ gap-2 items-center'>
          <Info size={20} />
          <strong>Interpretation Guide:</strong>
        </header>
        <ul un-list="disc inside" un-mt="1" un-space-y="1">
          <li><strong>Asset Managers (Blue):</strong> Asset Managers / Institutional (asset_mgr): These are pension funds, mutual funds, endowments, and insurance companies. They are the "Real Money."
            <p>
              Behavior: They are structurally long-biased (they have to hold equities). They move slowly and reallocate over months or quarters.
            </p>
          </li>
          <li><strong>Leveraged Funds (Green):</strong> Leveraged Money (lev_money): These are hedge funds, Commodity Trading Advisors (CTAs), and proprietary trading desks. They are the "Fast Money" or "Smart Money."
            <p>
              Behavior: They use leverage, move quickly, and are heavily trend-following. They go both long and short aggressively.
            </p>
          </li>
          <li><strong>Dealers (Red):</strong> Dealer / Intermediary (dealer): These are the big Wall Street banks (sell-side).
            <p>
              Behavior: They don't usually take speculative bets. They facilitate trades for clients and delta-hedge their options/OTC books. Traders usually ignore them for directional bias, as their positions are just hedges.
            </p>
          </li>
          <li>
            <strong>Other Reportables (Gray): </strong>
            These are retail traders and small speculators who don't meet the size threshold to be reported individually.
            <p>
              Behavior: "Dumb Money." Often used as a contrarian indicator.
            </p>
          </li>
        </ul>
      </div>
    </div>
  )
}
