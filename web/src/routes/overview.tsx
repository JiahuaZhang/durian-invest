import { createFileRoute } from '@tanstack/react-router';
import { EconomicCalendar, MarketOverview, MarketOverviewProps, MiniChart, StockHeatmap, StockMarket } from 'react-ts-tradingview-widgets';

export const Route = createFileRoute('/overview')({
  component: Overview
})

const commonProps: MarketOverviewProps = {
  width: "100%",
  height: "100%",
  dateRange: '1M'
} as const;

const equitiesTabs = [
  {
    title: "Equities",
    symbols: [
      { s: "SP500", d: "S&P 500" },
      { s: "NASDAQ", d: "US 100" },
      { s: "RUSSELL", d: "US Small Cap 2000 Index" },
      { s: "DJI", d: "Dow 30" },
      { s: "DEU40", d: "Europe DAX" },
      { s: "NKY", d: "Japan Nikkei 225" },
      // { s: "FTSE", d: "UK 100" },
    ],
    originalTitle: "Equities"
  }
];

const commoditiesTabs = [
  {
    title: "Commodities",
    symbols: [
      { s: "GOLD", d: "Gold" },
      { s: "BTCUSD", d: "Bitcoin" },
      { s: "USOIL", d: "Crude Oil" },
      { s: "SILVER", d: "Silver" },
      { s: "COPPER", d: "Copper" },
      // { s: "PLATINUM", d: "Platinum" },
    ],
    originalTitle: "Commodities"
  }
];

const bondsTabs = [
  {
    title: "Bonds",
    symbols: [
      { s: "US10Y", d: "US 10 Year T-Bond" },
      { s: "US02Y", d: "US 2 Year T-Bond" },
      // { s: "EUREX:FGBL1!", d: "Euro Bund" },
      // { s: "EUREX:FBTP1!", d: "Euro BTP" },
      // { s: "EUREX:FGBM1!", d: "Euro BOBL" },
    ],
    originalTitle: "Bonds"
  }
];

const forexTabs = [
  {
    title: "Forex",
    symbols: [
      { s: "DXY", d: "Dollar Index" },
      { s: "EURUSD", d: "EUR to USD" },
      { s: "GBPUSD", d: "GBP to USD" },
      { s: "USDCNH", d: "USD to CNH" },
      { s: "USDJPY", d: "USD to JPY" },
      // { s: "USDCHF", d: "USD to CHF" },
      // { s: "AUDUSD", d: "AUD to USD" },
      // { s: "USDCAD", d: "USD to CAD" },
    ],
    originalTitle: "Forex"
  }
];

function Overview() {
  return (
    <div un-p="2" un-flex="~ wrap justify-center" un-gap="2">
      <div un-flex="1" un-min-w="xs" un-max-w='sm' un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
        <MarketOverview {...commonProps} tabs={equitiesTabs} />
      </div>

      <div un-flex="1" un-min-w="xs" un-max-w='sm' un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
        <MarketOverview {...commonProps} tabs={commoditiesTabs} />
      </div>

      <div un-flex="1" un-min-w="xs" un-max-w='sm' un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
        <MiniChart {...commonProps} symbol="CAPITALCOM:VIX" />
      </div>

      <div un-flex="1" un-min-w="xs" un-max-w='sm' un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
        <StockMarket {...commonProps} />
      </div>

      <div un-flex="1" un-min-w="xs" un-max-w='sm' un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
        <MarketOverview {...commonProps} tabs={bondsTabs} />
      </div>

      <div un-flex="1" un-min-w="xs" un-max-w='sm' un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white">
        <MarketOverview {...commonProps} tabs={forexTabs} />
      </div>

      <div un-flex="1" un-min-w="sm" un-h="150" un-rounded="xl" un-overflow="hidden" un-border="~ slate-200" un-shadow="sm" un-bg="white" >
        <StockHeatmap {...commonProps} exchanges={["NYSE", "NASDAQ"]} />
      </div>

      <div un-w='sm' un-min-h='lg' >
        <EconomicCalendar
          width="100%"
          height="100%"
          countryFilter="us"
          importanceFilter="0,1"
        />
      </div>

    </div>
  )
}
