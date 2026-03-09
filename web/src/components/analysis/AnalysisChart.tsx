import { CandleAnalysis } from './candle/CandleAnalysis';
import type { CandleData } from './context/ChartContext';
import { CandleDataProvider } from './context/ChartDataContext';
import { OptionAnalysis } from './option/OptionAnalysis';

export type AnalysisChartProps = {
    readonly data: CandleData[];
    readonly symbol: string;
};

export function AnalysisChart({ data, symbol }: AnalysisChartProps) {
    return (
        <CandleDataProvider initialData={data}>
            <div un-flex="~ col gap-4">
                <CandleAnalysis />
                <OptionAnalysis symbol={symbol} key={symbol} />
            </div>
        </CandleDataProvider>
    );
}
