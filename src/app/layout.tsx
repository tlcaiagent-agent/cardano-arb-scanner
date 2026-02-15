import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cardano DEX Arbitrage Scanner',
  description: 'Real-time arbitrage opportunity scanner across Cardano DEXs',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0e17] text-slate-200 antialiased">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  )
}

function Header() {
  return (
    <header className="border-b border-slate-800 bg-[#0d1220]/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            ◈ CardanoArb
          </span>
          <nav className="hidden sm:flex items-center gap-1 ml-6">
            <NavLink href="/">Scanner</NavLink>
            <NavLink href="/stats">Stats</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">ADA</span>
          <AdaTicker />
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 pulse-dot" title="Live" />
        </div>
      </div>
    </header>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/5 transition">
      {children}
    </a>
  )
}

function AdaTicker() {
  return <span className="font-mono text-emerald-400">$0.73</span>
}
