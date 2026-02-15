'use client'

import { useEffect, useState } from 'react'
import { TradeRecord } from '@/lib/types'

export default function HistoryPage() {
  const [trades, setTrades] = useState<TradeRecord[]>([])

  useEffect(() => {
    const stored = localStorage.getItem('cardano-arb-history')
    if (stored) {
      try { setTrades(JSON.parse(stored)) } catch {}
    }
  }, [])

  const totalTrades = trades.length
  const totalProfit = trades.reduce((s, t) => s + t.profitAda, 0)
  const wins = trades.filter(t => t.profitAda > 0).length
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0
  const avgProfit = totalTrades > 0 ? totalProfit / totalTrades : 0

  function exportCSV() {
    const header = 'Timestamp,Pair,Buy DEX,Sell DEX,Spread %,Profit ADA,Amount ADA,Status'
    const rows = trades.map(t =>
      `${new Date(t.timestamp).toISOString()},${t.pair},${t.buyDex},${t.sellDex},${t.spreadPct.toFixed(2)},${t.profitAda.toFixed(4)},${t.amount},${t.status}`
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cardano-arb-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function addDemoTrade() {
    const dexes = ['Minswap', 'SundaeSwap', 'WingRiders', 'MuesliSwap']
    const pairs = ['ADA/MIN', 'ADA/SNEK', 'ADA/HOSKY', 'ADA/SUNDAE', 'ADA/INDY']
    const spread = 0.5 + Math.random() * 4
    const profit = (spread / 100) * 1000 - 1.5
    const trade: TradeRecord = {
      id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now() - Math.floor(Math.random() * 86400000),
      pair: pairs[Math.floor(Math.random() * pairs.length)],
      buyDex: dexes[Math.floor(Math.random() * dexes.length)],
      sellDex: dexes[Math.floor(Math.random() * dexes.length)],
      spreadPct: spread,
      profitAda: profit,
      amount: 1000,
      status: Math.random() > 0.3 ? 'manual' : 'planned',
    }
    const updated = [trade, ...trades]
    setTrades(updated)
    localStorage.setItem('cardano-arb-history', JSON.stringify(updated))
  }

  function clearHistory() {
    setTrades([])
    localStorage.removeItem('cardano-arb-history')
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📜 Trade History</h1>
        <div className="flex gap-2">
          <button onClick={addDemoTrade} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-sm text-slate-300 transition">
            + Add Demo Trade
          </button>
          <button onClick={exportCSV} disabled={trades.length === 0} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition">
            📥 Export CSV
          </button>
          {trades.length > 0 && (
            <button onClick={clearHistory} className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 rounded text-sm transition">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Trades" value={totalTrades} />
        <StatCard label="Total Profit" value={`${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)} ₳`} color={totalProfit > 0 ? 'text-emerald-400' : 'text-red-400'} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(0)}%`} color={winRate > 50 ? 'text-emerald-400' : 'text-yellow-400'} />
        <StatCard label="Avg Profit" value={`${avgProfit > 0 ? '+' : ''}${avgProfit.toFixed(2)} ₳`} color={avgProfit > 0 ? 'text-emerald-400' : 'text-red-400'} />
      </div>

      {/* Trade Table */}
      {trades.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-slate-800/20 rounded-lg border border-slate-800">
          <div className="text-4xl mb-3">📭</div>
          <div className="text-lg">No trade history yet</div>
          <div className="text-sm mt-1">Trades will appear here when you execute them via the Execute page.<br />Click &quot;Add Demo Trade&quot; to see how it looks.</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase">
                <th className="text-left px-4 py-3">Timestamp</th>
                <th className="text-left px-3 py-3">Pair</th>
                <th className="text-left px-3 py-3">Buy DEX</th>
                <th className="text-left px-3 py-3">Sell DEX</th>
                <th className="text-right px-3 py-3">Spread %</th>
                <th className="text-right px-3 py-3">Profit ₳</th>
                <th className="text-right px-3 py-3">Amount ₳</th>
                <th className="text-center px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {trades.sort((a, b) => b.timestamp - a.timestamp).map(t => (
                <tr key={t.id} className="hover:bg-slate-800/30 transition">
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {new Date(t.timestamp).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-medium">{t.pair}</td>
                  <td className="px-3 py-3"><DexBadge dex={t.buyDex} /></td>
                  <td className="px-3 py-3"><DexBadge dex={t.sellDex} /></td>
                  <td className={`px-3 py-3 text-right font-mono ${t.spreadPct > 2 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                    {t.spreadPct.toFixed(2)}%
                  </td>
                  <td className={`px-3 py-3 text-right font-mono ${t.profitAda > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.profitAda > 0 ? '+' : ''}{t.profitAda.toFixed(2)} ₳
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{t.amount} ₳</td>
                  <td className="px-3 py-3 text-center">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg px-4 py-3">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold font-mono mt-0.5 ${color || 'text-white'}`}>{value}</div>
    </div>
  )
}

const dexColors: Record<string, string> = {
  Minswap: 'bg-blue-500/20 text-blue-300',
  SundaeSwap: 'bg-purple-500/20 text-purple-300',
  WingRiders: 'bg-cyan-500/20 text-cyan-300',
  MuesliSwap: 'bg-amber-500/20 text-amber-300',
}

function DexBadge({ dex }: { dex: string }) {
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${dexColors[dex] || 'bg-slate-700 text-slate-300'}`}>{dex}</span>
}

const statusColors: Record<string, string> = {
  planned: 'bg-blue-500/20 text-blue-300',
  executed: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-500/20 text-red-300',
  manual: 'bg-purple-500/20 text-purple-300',
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[status] || 'bg-slate-700 text-slate-300'}`}>{status}</span>
}
