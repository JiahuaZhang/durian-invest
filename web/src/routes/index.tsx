import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

const links = [
  { link: 'https://tradingview.com/', name: 'Trading View' },
  { link: 'https://optioncharts.io/', name: 'Option Charts' },
  { link: 'https://www.google.com/finance', name: 'Google Finance' },
]

function App() {
  return (
    <div un-p="8">
      <div un-flex='~ col gap-2'>
        {
          links.map((link) => (
            <a un-text="blue-500" key={link.link} href={link.link} target="_blank" rel="noopener noreferrer">
              {link.name}
            </a>
          ))
        }
      </div>
    </div>
  )
}
