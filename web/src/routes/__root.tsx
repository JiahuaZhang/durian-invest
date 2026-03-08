import { TanStackDevtools } from '@tanstack/react-devtools'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import unoCss from '../uno.css?url'
import { Sidebar } from '../components/Sidebar'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Durian Invest',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: unoCss,
      },
    ],
  }),

  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div un-flex="~" un-h-full="~" un-items-center="~" un-justify-center="~" un-p="8" un-text-center="~">
      <div un-space-y="4">
        <h1 un-text="4xl" un-font-bold="~" un-text-slate="800">404</h1>
        <p un-text-slate="500">Page not found</p>
      </div>
    </div>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body un-flex="~" un-h="screen" un-overflow="hidden" un-text="slate-900" >
        <Sidebar />

        <main un-flex="1" un-overflow="auto" un-position="relative">
          {children}

          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
          <Scripts />
        </main>
      </body>
    </html>
  )
}
