import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Tab = {
    id: string;
    label: string;
    content: ReactNode;
};

type ChartConfigPopupProps = {
    title: string;
    tabs: Tab[];
    isOpen: boolean;
    onClose: () => void;
    triggerRef: React.RefObject<HTMLElement | null>;
};

export function ChartConfigPopup({ title, tabs, isOpen, onClose }: ChartConfigPopupProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? '');

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const activeTabContent = tabs.find(t => t.id === activeTab)?.content;

    return (
        <>
            {/* Backdrop with flexbox centering */}
            <div
                un-position="fixed inset-0"
                un-flex="~ items-center justify-center"
                un-bg="black/20"
                un-z="50"
                onClick={onClose}
            >
                {/* Centered Modal */}
                <div
                    ref={popupRef}
                    un-bg="white"
                    un-border="~ slate-200 rounded-lg"
                    un-shadow="xl"
                    un-min-w="xs"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div un-flex="~ items-center justify-between" un-p="3" un-border="b slate-200">
                        <span un-text="sm" un-font="semibold">{title}</span>
                        <button
                            onClick={onClose}
                            un-p="1"
                            un-cursor="pointer"
                            un-text="slate-400 hover:slate-600"
                            un-bg="transparent hover:slate-100"
                            un-border="rounded"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div un-flex="~" un-border="b slate-200">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                un-p="x-4 y-2"
                                un-text={`sm ${activeTab === tab.id ? 'blue-600' : 'slate-500 hover:slate-700'}`}
                                un-border={activeTab === tab.id ? 'b-2 blue-600' : 'b-2 transparent'}
                                un-bg="transparent hover:slate-50"
                                un-cursor="pointer"
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div un-p="4">
                        {activeTabContent}
                    </div>
                </div>
            </div>
        </>
    );
}
