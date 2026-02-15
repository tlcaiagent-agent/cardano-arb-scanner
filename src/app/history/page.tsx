'use client'

import { useEffect, useState } from 'react'
import { loadTradeHistory, TradeExecution } from '@/lib/trade-engine'

type TimeFilter = 'today' | 'week' | 'month' | 'all'

export default function HistoryPage() {
  const [trades, setTrades] = useState<TradeExecution[]>([])
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')

  useEffect(() => {
    setTrades(loadTradeHistory())
  }, [])

  const now = Date.now()
  const dayMs = 86400000
  const filtered = trades.filter(t => {
    if (timeFilter === 'today') return now - t.timestamp < dayMs
    if (timeFilter === 'week') return now - t.timestamp < dayMs * 7
    if (timeFilter === 'month') return now - t.timestamp < dayMs * 30
    return true
  })

  const completed = filtered.filter(t => t.status === 'completed' || t.status === 'dry-run')
  const totalProfit = completed.reduce((s, t) => s + t.netProfit, 0)
  const wins = completed.filter(t => t.netProfit > 0).length
  const winRate = completed.length > 0 ? (wins / completed.length * 100) : 0
  const avgProfit = completed.length > 0 ? totalProfit / completed.length : 0
  const totalVolume = completed.reduce((s, t) => s + t.amount, 0)
  const totalFees = completed.reduce((s, t) => s + (t.fees || 0), 0)

  function exportCSV() {
    const header = 'Timestamp,Pair,Buy DEX,Sell DEX,Amount ADA,Buy Price,Sell Price,Fees,Net Profit,Status,Dry Run,Buy TX Hash,Sell TX Hash'
    const rows = filtered.map(t =>
      [
        new Date(t.timestamp).toISOString(),
        t.pair,
        t.buyDex,
        t.sellDex,
        t.amount,
        t.buyPrice?.toFixed(8) || '',
        t.sellPrice?.toFixed(8) || '',
        t.fees?.toFixed(4) || '',
        t.netProfit.toFixed(4),
        t.status,
        t.dryRun ? 'yes' : 'no',
        t.buyTxHash || '',
        t.sellTxHash || '',
      ].join(',')
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

  function clearHistory() {
    if (confirm('Clear all trade history? This cannot be undone.')) {
      localStorage.removeItem('cardano-arb-trades')
      setTrades([])
    }
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📜 Trade History</h1>
        <div className="flex gap-2">
          <button onClick={exportCSV} disabled={filtered.length === 0} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition">
            📥 Export CSV
          </button>
          {trades.length > 0 && (
            <button onClick={clearHistory} className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 rounded text-sm transition">
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Time Filter Tabs */}
      <div className="flex gap-1 bg-slate-800/30 rounded-lg p-1 w-fit">
        {(['today', 'week', 'month', 'all'] as TimeFilter[]).map(tf => (
          <button
            key={tf}
            onClick={() => setTimeFilter(tf)}
            className={`px-3 py-1.5 rounded text-sm transition ${
              timeFilter === tf
                ? 'bg-blue-600 text-white font-medium'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            {tf === 'today' ? 'Today' : tf === 'week' ? 'This Week' : tf === 'month' ? 'This Month' : 'All Time'}
          </button>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <StatCard label="Total Trades" value={completed.length} />
        <StatCard label="Net P&L" value={`${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)} ₳`} color={totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(0)}%`} color={winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400'} />
        <StatCard label="Avg Profit" value={`${avgProfit > 0 ? '+' : ''}${avgProfit.toFixed(2)} ₳`} color={avgProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        <StatCard label="Volume" value={`${totalVolume.toFixed(0)} ₳`} />
        <StatCard label="Total Fees" value={`${totalFees.toFixed(2)} ₳`} color="text-orange-400" />
      </div>

      {/* P&L Bar */}
      {completed.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Daily P&L</div>
          <div className="flex items-end gap-1 h-20">
            {getDailyBars(completed).map((bar, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                <div
                  className={`w-full rounded-t ${bar.value >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                  style={{ height: `${Math.min(Math.abs(bar.pct), 100)}%`, minHeight: bar.value !== 0 ? '2px' : 0 }}
                />
                <div className="text-[8px] text-slate-500 mt-1 truncate w-full text-center">{bar.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trade Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-slate-800/20 rounded-lg border border-slate-800">
          <div className="text-4xl mb-3">📭</div>
          <div className="text-lg">No trades found</div>
          <div className="text-sm mt-1">Execute trades from the Execute page to see them here.</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase">
                <th className="text-left px-3 py-3">Timestamp</th>
                <th className="text-left px-3 py-3">Pair</th>
                <th className="text-left px-3 py-3">Buy DEX</th>
                <th className="text-left px-3 py-3">Sell DEX</th>
                <th className="text-right px-3 py-3">Amount</th>
                <th className="text-right px-3 py-3">Fees</th>
                <th className="text-right px-3 py-3">Net P&L</th>
                <th className="text-center px-3 py-3">Status</th>
                <th className="text-center px-3 py-3">TX</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filtered.sort((a, b) => b.timestamp - a.timestamp).map(t => (
                <tr key={t.id} className="hover:bg-slate-800/30 transition">
                  <td className="px-3 py-3 font-mono text-xs text-slate-400">
                    {new Date(t.timestamp).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-medium">{t.pair}</td>
                  <td className="px-3 py-3"><DexBadge dex={t.buyDex} /></td>
                  <td className="px-3 py-3"><DexBadge dex={t.sellDex} /></td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{t.amount} ₳</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-500">{(t.fees || 0).toFixed(2)} ₳</td>
                  <td className={`px-3 py-3 text-right font-mono font-bold ${t.netProfit > 0 ? 'text-emerald-400' : t.netProfit < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {t.netProfit > 0 ? '+' : ''}{t.netProfit.toFixed(2)} ₳
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      t.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' :
                      t.status === 'dry-run' ? 'bg-yellow-500/20 text-yellow-300' :
                      t.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                      'bg-blue-500/20 text-blue-300'
                    }`}>
                      {t.dryRun ? '🧪 ' : ''}{t.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center text-xs">
                    {t.buyTxHash ? (
                      <a href={`https://cardanoscan.io/transaction/${t.buyTxHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                        Buy
                      </a>
                    ) : null}
                    {t.buyTxHash && t.sellTxHash ? ' / ' : ''}
                    {t.sellTxHash ? (
                      <a href={`https://cardanoscan.io/transaction/${t.sellTxHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                        Sell
                      </a>
                    ) : null}
                    {!t.buyTxHash && !t.sellTxHash ? <span className="text-slate-600">—</span> : null}
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

function getDailyBars(trades: TradeExecution[]): { label: string; value: number; pct: number }[] {
  const days: Record<string, number> = {}
  for (const t of trades) {
    const d = new Date(t.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    days[d] = (days[d] || 0) + t.netProfit
  }
  const entries = Object.entries(days).slice(-14)
  const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)), 1)
  return entries.map(([label, value]) => ({ label, value, pct: (Math.abs(value) / maxAbs) * 80 }))
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
