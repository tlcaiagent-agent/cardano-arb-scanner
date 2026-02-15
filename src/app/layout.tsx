'use client'

import './globals.css'
import { useState } from 'react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <title>Cardano DEX Arbitrage Scanner</title>
        <meta name="description" content="Real-time arbitrage opportunity scanner across Cardano DEXs" />
      </head>
      <body className="min-h-screen bg-[#0a0e17] text-slate-200 antialiased">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  )
}

function Header() {
  const [walletOpen, setWalletOpen] = useState(false)

  return (
    <>
      <header className="border-b border-slate-800 bg-[#0d1220]/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              ◈ CardanoArb
            </a>
            <nav className="hidden sm:flex items-center gap-1 ml-6">
              <NavLink href="/">Scanner</NavLink>
              <NavLink href="/execute">Execute</NavLink>
              <NavLink href="/history">History</NavLink>
              <NavLink href="/stats">Stats</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={() => setWalletOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition text-xs font-medium"
            >
              🔗 Connect Wallet
            </button>
            <span className="text-slate-500">ADA</span>
            <span className="font-mono text-emerald-400">$0.73</span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 pulse-dot" title="Live" />
          </div>
        </div>
      </header>

      {/* Wallet Modal */}
      {walletOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setWalletOpen(false)}>
          <div className="bg-[#111827] border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Connect Wallet</h2>
              <button onClick={() => setWalletOpen(false)} className="text-slate-500 hover:text-white text-xl">×</button>
            </div>
            <p className="text-slate-400 text-sm mb-4">
              Wallet connection coming soon! For now, use the execution plans to manually trade on the DEX websites.
            </p>
            <div className="space-y-2 mb-4">
              {['Nami', 'Eternl', 'Flint', 'Lace', 'Vespr'].map(w => (
                <div key={w} className="flex items-center justify-between bg-slate-800/50 border border-slate-700/50 rounded-lg px-4 py-3">
                  <span className="text-sm font-medium">{w}</span>
                  <span className="text-xs text-slate-500">Coming soon</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Supported wallets will include Nami, Eternl, Flint, Lace, and Vespr via CIP-30 browser wallet API.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/5 transition">
      {children}
    </a>
  )
}
