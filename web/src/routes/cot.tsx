import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { LayoutDashboard } from 'lucide-react'

export const Route = createFileRoute('/cot')({
  component: CotLayout
})

const links = [
  { to: '/cot/spx', label: 'S&P 500', },
  { to: '/cot/ndx', label: 'Nasdaq (NDX)', },
  { to: '/cot/gold', label: 'Gold', },
  { to: '/cot/silver', label: 'Silver', },
]

function CotLayout() {
  return (
    <div un-flex="~ col">
      <div un-flex="~ items-center gap-4" un-p="2" un-border="b slate-200">
        <div un-flex="~ items-center gap-2">
          <LayoutDashboard size={20} un-text="slate-500" />
          <span un-font="semibold" un-text="slate-700">COT Reports</span>
        </div>

        <nav un-flex="~ gap-2">
          {
            links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                activeProps={{ className: 'bg-blue-50 text-blue-800' }}
                inactiveProps={{ className: 'text-slate-500 hover:bg-slate-50 hover:text-slate-700' }}
                un-p="x-3 y-1.5" un-text="sm" un-border="rounded"
              >
                {link.label}
              </Link>
            ))
          }
        </nav>
      </div>

      <div un-flex="1">
        <Outlet />
      </div>
    </div>
  )
}
