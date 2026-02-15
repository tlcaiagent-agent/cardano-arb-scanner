'use client'

import './globals.css'
import { useState } from 'react'
import { WalletProvider } from '@/lib/wallet-context'
import { useWallet } from '@/lib/wallet-context'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <title>Cardano DEX Arbitrage Scanner</title>
        <meta name="description" content="Real-time arbitrage opportunity scanner across Cardano DEXs" />
      </head>
      <body className="min-h-screen bg-[#0a0e17] text-slate-200 antialiased">
        <WalletProvider>
          <Header />
          <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
        </WalletProvider>
      </body>
    </html>
  )
}

function Header() {
  const [walletOpen, setWalletOpen] = useState(false)
  const wallet = useWallet()

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
            {wallet.connected ? (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400 font-medium">{wallet.walletName}</span>
                <span className="font-mono text-xs text-slate-400">{wallet.addressTruncated}</span>
                <span className="font-mono text-emerald-400 font-bold">{wallet.balance.toFixed(1)} ₳</span>
                <button
                  onClick={() => wallet.disconnect()}
                  className="px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 transition"
                  title="Disconnect wallet"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => { wallet.refreshWallets(); setWalletOpen(true) }}
                className="px-3 py-1.5 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition text-xs font-medium"
              >
                🔗 Connect Wallet
              </button>
            )}
            <span className="text-slate-500">ADA</span>
            <span className="font-mono text-emerald-400">$0.73</span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 pulse-dot" title="Live" />
          </div>
        </div>
      </header>

      {/* Wallet Connection Modal */}
      {walletOpen && !wallet.connected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setWalletOpen(false)}>
          <div className="bg-[#111827] border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Connect Wallet</h2>
              <button onClick={() => setWalletOpen(false)} className="text-slate-500 hover:text-white text-xl">×</button>
            </div>

            {wallet.error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4 text-red-400 text-sm">
                {wallet.error}
              </div>
            )}

            {wallet.connecting && (
              <div className="text-center py-6 text-blue-400">
                <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full mb-2" />
                <div className="text-sm">Connecting...</div>
              </div>
            )}

            {!wallet.connecting && (
              <>
                {wallet.detectedWallets.length > 0 ? (
                  <div className="space-y-2 mb-4">
                    {wallet.detectedWallets.map(w => (
                      <button
                        key={w.id}
                        onClick={async () => {
                          await wallet.connect(w.id)
                          if (wallet.connected) setWalletOpen(false)
                          // Close after a brief delay since state updates async
                          setTimeout(() => setWalletOpen(false), 500)
                        }}
                        className="w-full flex items-center justify-between bg-slate-800/50 border border-slate-700/50 rounded-lg px-4 py-3 hover:border-purple-500/50 hover:bg-purple-900/10 transition"
                      >
                        <div className="flex items-center gap-3">
                          {w.icon && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={w.icon} alt={w.name} className="w-7 h-7 rounded" />
                          )}
                          <span className="text-sm font-medium">{w.name}</span>
                        </div>
                        <span className="text-xs text-slate-500">v{w.apiVersion}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 mb-4">
                    <div className="text-3xl mb-2">🔌</div>
                    <p className="text-slate-400 text-sm mb-3">No Cardano wallets detected</p>
                    <p className="text-xs text-slate-500">
                      Install <a href="https://eternl.io" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">Eternl</a>,{' '}
                      <a href="https://namiwallet.io" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">Nami</a>, or{' '}
                      <a href="https://www.lace.io" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">Lace</a>{' '}
                      browser extension
                    </p>
                  </div>
                )}

                <button
                  onClick={() => { wallet.refreshWallets() }}
                  className="w-full text-center text-xs text-slate-500 hover:text-slate-300 py-2"
                >
                  ↻ Refresh wallet list
                </button>
              </>
            )}
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
