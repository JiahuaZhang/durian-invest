import { createContext, useContext, type ReactNode } from 'react';

// ============================================================================
// Types
// ============================================================================

export type CandleData = {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    adjustClose: number;
};

// ============================================================================
// Context
// ============================================================================

type CandleDataContextType = {
    data: CandleData[];
};

const CandleDataContext = createContext<CandleDataContextType | null>(null);

type CandleDataProviderProps = {
    children: ReactNode;
    initialData: CandleData[];
};

export function CandleDataProvider({ children, initialData }: CandleDataProviderProps) {
    return (
        <CandleDataContext.Provider value={{ data: initialData }}>
            {children}
        </CandleDataContext.Provider>
    );
}

export function useCandleData() {
    const context = useContext(CandleDataContext);
    if (!context) {
        throw new Error('useCandleData must be used within a CandleDataProvider');
    }
    return context.data;
}
