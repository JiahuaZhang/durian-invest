import { OptionAnalysis } from './option/OptionAnalysis';
import { CandleAnalysis } from './candle/CandleAnalysis';
import type { CandleData } from './candle/context/ChartContext';

export type AnalysisChartProps = {
    readonly data: CandleData[];
    readonly symbol: string;
};

export function AnalysisChart({ data, symbol }: AnalysisChartProps) {
    return (
        <div un-flex="~ col gap-8">
            <CandleAnalysis data={data} />
            <OptionAnalysis symbol={symbol} key={symbol} />
        </div>
    );
}
