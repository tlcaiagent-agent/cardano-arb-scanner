'use client'

import { useEffect, useState, useCallback } from 'react'
import { ArbResponse } from '@/lib/types'
import { REFRESH_INTERVAL_MS, DEFAULT_TRADE_SIZE_ADA } from '@/lib/constants'

type SortKey = 'spreadPct' | 'netProfitAda' | 'buyLiquidity'

export default function ScannerPage() {
  const [data, setData] = useState<ArbResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('spreadPct')
  const [minSpread, setMinSpread] = useState(0)
  const [tradeSize, setTradeSize] = useState(DEFAULT_TRADE_SIZE_ADA)
  const [tokenFilter, setTokenFilter] = useState('')
  const [tab, setTab] = useState<'direct' | 'triangular'>('direct')
  const [countdown, setCountdown] = useState(15)

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`/api/arbitrage?tradeSize=${tradeSize}&minSpread=${minSpread}`)
      const json: ArbResponse = await r.json()
      setData(json)
    } catch (e) {
      console.error('Fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [tradeSize, minSpread])

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, REFRESH_INTERVAL_MS)
    return () => clearInterval(iv)
  }, [fetchData])

  useEffect(() => {
    setCountdown(15)
    const iv = setInterval(() => setCountdown(c => (c <= 1 ? 15 : c - 1)), 1000)
    return () => clearInterval(iv)
  }, [data])

  const opps = data?.opportunities
    .filter(o => !tokenFilter || o.pair.toLowerCase().includes(tokenFilter.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'buyLiquidity') return Math.min(b.buyLiquidity, b.sellLiquidity) - Math.min(a.buyLiquidity, a.sellLiquidity)
      return (b as any)[sortBy] - (a as any)[sortBy]
    }) || []

  const triArbs = data?.triangular.filter(t => t.profitPct > 0) || []

  return (
    <div className="space-y-6 fade-in">
      {/* Demo banner */}
      {data?.isDemo && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 text-amber-300 text-sm flex items-center gap-2">
          <span>⚠️</span>
          <span><strong>DEMO DATA</strong> — Live DEX APIs unavailable. Showing simulated prices to demonstrate the scanner. Real API integration is a config swap away.</span>
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Opportunities" value={data?.stats.totalOpportunities ?? '—'} />
        <StatCard label="Best Spread" value={data?.stats.bestSpread ? `${data.stats.bestSpread.toFixed(2)}%` : '—'} color="text-emerald-400" />
        <StatCard label="Avg Spread" value={data?.stats.avgSpread ? `${data.stats.avgSpread.toFixed(2)}%` : '—'} />
        <StatCard label="Refresh" value={`${countdown}s`} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <FilterInput label="Trade Size (ADA)" type="number" value={tradeSize} onChange={v => setTradeSize(Number(v) || DEFAULT_TRADE_SIZE_ADA)} />
        <FilterInput label="Min Spread %" type="number" value={minSpread} onChange={v => setMinSpread(Number(v) || 0)} step="0.1" />
        <FilterInput label="Token Filter" value={tokenFilter} onChange={setTokenFilter} placeholder="e.g. SNEK" />
        <div className="flex gap-1 ml-auto">
          <TabBtn active={tab === 'direct'} onClick={() => setTab('direct')}>Direct Arb</TabBtn>
          <TabBtn active={tab === 'triangular'} onClick={() => setTab('triangular')}>Triangular</TabBtn>
        </div>
      </div>

      {/* EUTXO note */}
      <div className="text-xs text-slate-500 bg-slate-800/30 rounded px-3 py-1.5">
        ℹ️ Cardano uses EUTXO — arbitrage execution requires specific UTXO handling, not simple swaps like EVM chains. This scanner is for <strong>monitoring only</strong>.
      </div>

      {tab === 'direct' ? (
        /* Direct Arbitrage Table */
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase">
                <th className="text-left px-4 py-3">Pair</th>
                <th className="text-left px-3 py-3">Buy DEX</th>
                <th className="text-left px-3 py-3">Sell DEX</th>
                <th className="text-right px-3 py-3 cursor-pointer hover:text-white" onClick={() => setSortBy('spreadPct')}>
                  Spread % {sortBy === 'spreadPct' && '▼'}
                </th>
                <th className="text-right px-3 py-3 cursor-pointer hover:text-white" onClick={() => setSortBy('netProfitAda')}>
                  Net Profit {sortBy === 'netProfitAda' && '▼'}
                </th>
                <th className="text-right px-3 py-3 cursor-pointer hover:text-white" onClick={() => setSortBy('buyLiquidity')}>
                  Liquidity {sortBy === 'buyLiquidity' && '▼'}
                </th>
                <th className="text-right px-3 py-3">Buy Price</th>
                <th className="text-right px-3 py-3">Sell Price</th>
                <th className="text-center px-3 py-3">Fresh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-500">Loading...</td></tr>
              ) : opps.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-500">No opportunities found matching filters</td></tr>
              ) : opps.map(o => (
                <tr key={o.id} className="hover:bg-slate-800/30 transition">
                  <td className="px-4 py-3 font-medium">
                    <a href={`/pair/${o.tokenA}/${o.tokenB}`} className="hover:text-blue-400 transition">{o.pair}</a>
                  </td>
                  <td className="px-3 py-3"><DexBadge dex={o.buyDex} /></td>
                  <td className="px-3 py-3"><DexBadge dex={o.sellDex} /></td>
                  <td className={`px-3 py-3 text-right font-mono font-semibold ${tierColor(o.tier)}`}>
                    {o.spreadPct.toFixed(2)}%
                  </td>
                  <td className={`px-3 py-3 text-right font-mono ${o.netProfitAda > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {o.netProfitAda > 0 ? '+' : ''}{o.netProfitAda.toFixed(2)} ₳
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">
                    {formatK(Math.min(o.buyLiquidity, o.sellLiquidity))} ₳
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{formatPrice(o.buyPrice)}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-400">{formatPrice(o.sellPrice)}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${Date.now() - o.timestamp < 30000 ? 'bg-emerald-400 pulse-dot' : 'bg-yellow-400'}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Triangular Arbitrage */
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase">
                <th className="text-left px-4 py-3">DEX</th>
                <th className="text-left px-3 py-3">Route</th>
                <th className="text-right px-3 py-3">Profit %</th>
                <th className="text-right px-3 py-3">Est. Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {triArbs.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-slate-500">No profitable triangular routes found</td></tr>
              ) : triArbs.map(t => (
                <tr key={t.id} className="hover:bg-slate-800/30 transition">
                  <td className="px-4 py-3"><DexBadge dex={t.dex} /></td>
                  <td className="px-3 py-3 font-mono text-sm">{t.route.join(' → ')}</td>
                  <td className={`px-3 py-3 text-right font-mono font-semibold ${t.profitPct > 1 ? 'text-emerald-400' : t.profitPct > 0.5 ? 'text-yellow-400' : 'text-slate-400'}`}>
                    {t.profitPct.toFixed(3)}%
                  </td>
                  <td className={`px-3 py-3 text-right font-mono ${t.estimatedProfitAda > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.estimatedProfitAda > 0 ? '+' : ''}{t.estimatedProfitAda.toFixed(2)} ₳
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

function FilterInput({ label, ...props }: { label: string; value: any; onChange: (v: string) => void; [k: string]: any }) {
  const { onChange, ...rest } = props
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      <input
        {...rest}
        onChange={e => onChange(e.target.value)}
        className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white w-36 focus:outline-none focus:border-blue-500"
      />
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded text-sm transition ${active ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
      {children}
    </button>
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

function tierColor(tier: string) {
  return tier === 'green' ? 'text-emerald-400' : tier === 'yellow' ? 'text-yellow-400' : 'text-red-400'
}

function formatPrice(p: number) {
  if (p < 0.0001) return p.toExponential(2)
  if (p < 1) return p.toFixed(6)
  return p.toFixed(4)
}

function formatK(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
}
