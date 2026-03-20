export type ReportType = 'disaggregated' | 'tff'

export type ProductConfig = {
    key: string
    label: string
    ticker: string
    category: string
    contractCode: string
    type: ReportType
}

export const PRODUCTS: ProductConfig[] = [
    // === DISAGGREGATED ===
    // Metals
    { key: 'gold', label: 'Gold', ticker: 'GC', category: 'Metals', contractCode: '088691', type: 'disaggregated' },
    { key: 'silver', label: 'Silver', ticker: 'SI', category: 'Metals', contractCode: '084691', type: 'disaggregated' },
    { key: 'copper', label: 'Copper', ticker: 'HG', category: 'Metals', contractCode: '085692', type: 'disaggregated' },
    { key: 'platinum', label: 'Platinum', ticker: 'PL', category: 'Metals', contractCode: '076651', type: 'disaggregated' },
    { key: 'palladium', label: 'Palladium', ticker: 'PA', category: 'Metals', contractCode: '075651', type: 'disaggregated' },
    // Energies
    { key: 'crude-oil', label: 'Crude Oil WTI', ticker: 'CL', category: 'Energies', contractCode: '067651', type: 'disaggregated' },
    { key: 'natural-gas', label: 'Natural Gas', ticker: 'NG', category: 'Energies', contractCode: '023651', type: 'disaggregated' },
    { key: 'gasoline', label: 'RBOB Gasoline', ticker: 'RB', category: 'Energies', contractCode: '111659', type: 'disaggregated' },
    { key: 'heating-oil', label: 'ULSD NY Harbor', ticker: 'HO', category: 'Energies', contractCode: '022651', type: 'disaggregated' },
    // Grains
    { key: 'corn', label: 'Corn', ticker: 'ZC', category: 'Grains', contractCode: '002601', type: 'disaggregated' },
    { key: 'soybeans', label: 'Soybeans', ticker: 'ZS', category: 'Grains', contractCode: '005602', type: 'disaggregated' },
    { key: 'wheat', label: 'Wheat (CBOT)', ticker: 'ZW', category: 'Grains', contractCode: '001602', type: 'disaggregated' },
    { key: 'soybean-meal', label: 'Soybean Meal', ticker: 'ZM', category: 'Grains', contractCode: '026603', type: 'disaggregated' },
    { key: 'soybean-oil', label: 'Soybean Oil', ticker: 'ZL', category: 'Grains', contractCode: '007601', type: 'disaggregated' },
    // Livestock
    { key: 'live-cattle', label: 'Live Cattle', ticker: 'LE', category: 'Livestock', contractCode: '057642', type: 'disaggregated' },
    { key: 'lean-hogs', label: 'Lean Hogs', ticker: 'HE', category: 'Livestock', contractCode: '054642', type: 'disaggregated' },
    { key: 'feeder-cattle', label: 'Feeder Cattle', ticker: 'GF', category: 'Livestock', contractCode: '061642', type: 'disaggregated' },
    // Softs
    { key: 'coffee', label: 'Coffee', ticker: 'KC', category: 'Softs', contractCode: '083731', type: 'disaggregated' },
    { key: 'sugar', label: 'Sugar #11', ticker: 'SB', category: 'Softs', contractCode: '080732', type: 'disaggregated' },
    { key: 'cotton', label: 'Cotton #2', ticker: 'CT', category: 'Softs', contractCode: '033661', type: 'disaggregated' },
    { key: 'cocoa', label: 'Cocoa', ticker: 'CC', category: 'Softs', contractCode: '073732', type: 'disaggregated' },
    { key: 'oj', label: 'Orange Juice', ticker: 'OJ', category: 'Softs', contractCode: '040701', type: 'disaggregated' },

    // === TFF (Traders in Financial Futures) ===
    // Indices
    { key: 'spx', label: 'S&P 500 E-Mini', ticker: 'ES', category: 'Indices', contractCode: '13874+', type: 'tff' },
    { key: 'ndx', label: 'Nasdaq 100 E-Mini', ticker: 'NQ', category: 'Indices', contractCode: '20974+', type: 'tff' },
    { key: 'djia', label: 'Dow Jones E-Mini', ticker: 'YM', category: 'Indices', contractCode: '12460+', type: 'tff' },
    { key: 'rut', label: 'Russell 2000 E-Mini', ticker: 'RTY', category: 'Indices', contractCode: '239742', type: 'tff' },
    // Currencies
    { key: 'dxy', label: 'US Dollar Index', ticker: 'DX', category: 'Currencies', contractCode: '098662', type: 'tff' },
    { key: 'eurusd', label: 'Euro FX', ticker: '6E', category: 'Currencies', contractCode: '099741', type: 'tff' },
    { key: 'gbpusd', label: 'British Pound', ticker: '6B', category: 'Currencies', contractCode: '096742', type: 'tff' },
    { key: 'jpyusd', label: 'Japanese Yen', ticker: '6J', category: 'Currencies', contractCode: '097741', type: 'tff' },
    { key: 'chfusd', label: 'Swiss Franc', ticker: '6S', category: 'Currencies', contractCode: '092741', type: 'tff' },
    { key: 'cadusd', label: 'Canadian Dollar', ticker: '6C', category: 'Currencies', contractCode: '090741', type: 'tff' },
    { key: 'audusd', label: 'Australian Dollar', ticker: '6A', category: 'Currencies', contractCode: '232741', type: 'tff' },
    { key: 'nzdusd', label: 'New Zealand Dollar', ticker: '6N', category: 'Currencies', contractCode: '112741', type: 'tff' },
    { key: 'mxnusd', label: 'Mexican Peso', ticker: '6M', category: 'Currencies', contractCode: '095741', type: 'tff' },
    // Rates
    { key: 'zb', label: '30-Year T-Bond', ticker: 'ZB', category: 'Rates', contractCode: '020601', type: 'tff' },
    { key: 'ub', label: 'Ultra T-Bond', ticker: 'UB', category: 'Rates', contractCode: '020604', type: 'tff' },
    { key: 'zn', label: '10-Year T-Note', ticker: 'ZN', category: 'Rates', contractCode: '043602', type: 'tff' },
    { key: 'zf', label: '5-Year T-Note', ticker: 'ZF', category: 'Rates', contractCode: '044601', type: 'tff' },
    { key: 'zt', label: '2-Year T-Note', ticker: 'ZT', category: 'Rates', contractCode: '042601', type: 'tff' },
    { key: 'zq', label: '30-Day Fed Funds', ticker: 'ZQ', category: 'Rates', contractCode: '045601', type: 'tff' },
]

export const REPORT_TYPES = [
    { key: 'disaggregated' as ReportType, label: 'Disaggregated' },
    { key: 'tff' as ReportType, label: 'Financial Futures' },
]

export const CFTC_ENDPOINTS: Record<ReportType, string> = {
    disaggregated: 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json',
    tff: 'https://publicreporting.cftc.gov/resource/yw9f-hn96.json',
}

export const DEFAULT_PRODUCT: Record<ReportType, string> = {
    disaggregated: 'gold',
    tff: 'spx',
}

export const getProduct = (key: string, type: ReportType) => PRODUCTS.find(p => p.key === key && p.type === type) ?? null

export const getProductsByType = (type: ReportType) => PRODUCTS.filter(p => p.type === type)

export const getCategoriesForType = (type: ReportType) => [...new Set(getProductsByType(type).map(p => p.category))]
