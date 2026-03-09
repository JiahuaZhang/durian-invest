import { createFileRoute } from '@tanstack/react-router';
import { MarketOverview, MarketOverviewProps, MiniChart, StockHeatmap, StockMarket } from 'react-ts-tradingview-widgets';

export const Route = createFileRoute('/overview')({
  component: Overview
})

const commonProps: MarketOverviewProps = {
  width: "100%",
  height: "100%",
  dateRange: '1M'
} as const;


const indicesTabs = [
  {
    title: "Indices",
    symbols: [
      { s: "FOREXCOM:SPXUSD", d: "S&P 500" },
      { s: "FOREXCOM:NSXUSD", d: "US 100" },
      { s: "CAPITALCOM:GOLD", d: "Gold" },
      { s: "TVC:USOIL", d: "Crude Oil" },
      { s: "CAPITALCOM:SILVER", d: "Silver" },
      { s: "CAPITALCOM:COPPER", d: "Copper" },
      { s: "CAPITALCOM:PLATINUM", d: "Platinum" },
      { s: "FOREXCOM:DJI", d: "Dow 30" },
      { s: "INDEX:NKY", d: "Nikkei 225" },
      { s: "INDEX:DEU40", d: "DAX Index" },
      { s: "FOREXCOM:UKXGBP", d: "UK 100" }
    ],
    originalTitle: "Indices"
  }
];

const bondsTabs = [
  {
    title: "Bonds",
    symbols: [
      { s: "CBOT:ZB1!", d: "T-Bond" },
      { s: "CBOT:UB1!", d: "Ultra T-Bond" },
      { s: "EUREX:FGBL1!", d: "Euro Bund" },
      { s: "EUREX:FBTP1!", d: "Euro BTP" },
      { s: "EUREX:FGBM1!", d: "Euro BOBL" }
    ],
    originalTitle: "Bonds"
  }
];

const forexTabs = [
  {
    title: "Forex",
    symbols: [
      { s: "FX:USDCNH", d: "USD to CNH" },
      { s: "FX:EURUSD", d: "EUR to USD" },
      { s: "FX:GBPUSD", d: "GBP to USD" },
      { s: "FX:USDJPY", d: "USD to JPY" },
      { s: "FX:USDCHF", d: "USD to CHF" },
      { s: "FX:AUDUSD", d: "AUD to USD" },
      { s: "FX:USDCAD", d: "USD to CAD" }
    ],
    originalTitle: "Forex"
  }
];

function Overview() {
  return (
    <div un-p="4" un-flex="~ col" un-gap="4">
      <h1 un-text="4xl transparent" un-font="bold" un-bg-gradient="to-r" un-from="purple-600" un-to="pink-600" un-bg="clip-text">
        Market Overview
      </h1>
      <div un-flex="~ col" un-gap="2">
        <div un-grid="~ cols-1 md:cols-3 xl:cols-4" un-gap="4">
          <div un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
            <MarketOverview {...commonProps} tabs={indicesTabs} />
          </div>
          <div un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
            <StockMarket {...commonProps} />
          </div>
          <div un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
            <MarketOverview {...commonProps} tabs={forexTabs} />
          </div>
          <div un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
            <MarketOverview {...commonProps} tabs={bondsTabs} />
          </div>
        </div>
      </div>

      <div un-flex="~" un-gap="4">
        <div un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
          <MiniChart {...commonProps} symbol="TVC:VIX" dateRange="12M" />
        </div>
        <div un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white" un-flex="1" >
          <StockHeatmap {...commonProps} exchanges={["NYSE", "NASDAQ"]} />
        </div>
      </div>
    </div>
  )
}

