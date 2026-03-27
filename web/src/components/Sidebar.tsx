import { Link, useLocation } from '@tanstack/react-router'
import {
    BarChart3,
    ChevronLeft,
    Coins,
    History,
    Home,
    LayoutGrid,
    LineChart,
    Menu,
    Newspaper,
    PieChart,
    PiggyBank,
    TrendingUp,
    Zap
} from 'lucide-react'
import { useState } from 'react'

export function Sidebar() {
    const [isExpanded, setIsExpanded] = useState(false)
    const location = useLocation()

    const navItems = [
        { icon: Home, label: 'Home', to: '/' },
        { icon: LayoutGrid, label: 'Overview', to: '/overview' },
        { icon: LineChart, label: 'Analysis', to: '/analysis' },
        { icon: Newspaper, label: 'News', to: '/news' },
        { icon: PieChart, label: 'COT Report', to: '/cot' },
        { icon: BarChart3, label: 'Depth (DOM)', to: '/dom/btc' },
        { icon: History, label: 'History', to: '/history' },
        { icon: Zap, label: 'Unusual Options', to: '/option/unusual/barchart' },
        { icon: TrendingUp, label: 'Option Chain', to: '/option/alpaca' },
        { icon: Coins, label: 'Gold Options', to: '/option/tastytrade' },
    ]

    return (
        <aside un-transition="all" un-duration="300" un-ease-in-out="~" un-bg="white/75" un-border="r slate-200"
            un-w={isExpanded ? "64" : "20"} un-shadow-xl="~" un-flex="~ col"
        >
            <div un-flex="~ items-center justify-between" un-p="x-4 y-3" un-border='b slate-200'>
                <div un-flex="~ gap-3  items-center" un-overflow="hidden" un-transition="all" un-duration="300" un-opacity={isExpanded ? "100" : "0"}>
                    <div un-w="8" un-h="8" un-rounded="lg" un-bg-gradient-to="tr" un-from-amber="400" un-to-yellow="400" un-flex="~ items-center justify-center" un-shrink="0">
                        <PiggyBank un-text='white' />
                    </div>
                    <span un-font-bold="~" un-text-lg="~" un-text-slate-800="~" un-whitespace-nowrap="~">Durian</span>
                </div>
                <button un-cursor='pointer' un-p="2" un-rounded="lg"
                    un-text-slate="400 hover:600" un-transition="colors" un-bg='hover:slate-100'
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    {isExpanded ? <ChevronLeft size={20} /> : <Menu size={20} />}
                </button>
            </div>

            <nav un-p="x-3 y-2" un-flex="~ col 1 gap-2">
                {navItems.map((item) => {
                    const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
                    return (
                        <Link className='group'
                            key={item.label}
                            to={item.to}
                            un-flex="~ items-center gap-3" un-p="3" un-rounded="xl" un-transition="all" un-duration="200"
                            un-bg={isActive ? 'blue-50' : 'transparent hover:slate-50'}
                            un-text={isActive ? 'blue-600' : 'slate-500 hover:slate-900'}
                            un-position='relative'
                            un-justify={isExpanded ? 'start' : 'center'}
                        >
                            <item.icon size={24} />

                            {
                                isExpanded &&
                                <span un-whitespace="nowrap" un-transition="all" un-duration="300">
                                    {item.label}
                                </span>
                            }

                            {!isExpanded && (
                                <div un-position="absolute" un-left="full" un-ml="2" un-p="x-2 y-1" un-bg-slate="800" un-text="white sm" un-rounded="md"
                                    un-opacity="0" un-group-hover="opacity-100"
                                    un-pointer-events="none" un-transition="opacity"
                                    un-z="50" un-shadow="xl"
                                >
                                    {item.label}
                                </div>
                            )}
                        </Link>
                    )
                })}
            </nav>

            <div un-p="x-4 y-3" un-border="t slate-200 rounded">
                <div un-flex="~ items-center gap-3">
                    <div un-w="10" un-h="10" un-rounded="full" un-bg-gradient-to="br" un-from-cyan="500" un-to-blue="500" un-shrink="0" />

                    <div un-overflow="hidden" un-transition="all" un-duration="300">
                        <p un-text="sm slate-900">User</p>
                        <p un-text="xs slate-500">Pro Plan</p>
                    </div>
                </div>
            </div>
        </aside>
    )
}
