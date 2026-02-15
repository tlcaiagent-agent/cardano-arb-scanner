'use client'

import { useEffect, useState } from 'react'
import { ArbResponse } from '@/lib/types'

export default function StatsPage() {
  const [data, setData] = useState<ArbResponse | null>(null)

  useEffect(() => {
    fetch('/api/arbitrage').then(r => r.json()).then(setData)
    const iv = setInterval(() => fetch('/api/arbitrage').then(r => r.json()).then(setData), 15000)
    return () => clearInterval(iv)
  }, [])

  if (!data) return <div className="text-center py-20 text-slate-500">Loading statistics...</div>

  const opps = data.opportunities
  const byPair = new Map<string, typeof opps>()
  const byDexPair = new Map<string, number[]>()

  for (const o of opps) {
    // By token pair
    const list = byPair.get(o.pair) || []
    list.push(o)
    byPair.set(o.pair, list)

    // By DEX pair
    const key = `${o.buyDex} → ${o.sellDex}`
    const spreads = byDexPair.get(key) || []
    spreads.push(o.spreadPct)
    byDexPair.set(key, spreads)
  }

  const topPairs = Array.from(byPair.entries())
    .map(([pair, os]) => ({
      pair,
      count: os.length,
      bestSpread: Math.max(...os.map(o => o.spreadPct)),
      avgSpread: os.reduce((s, o) => s + o.spreadPct, 0) / os.length,
      bestProfit: Math.max(...os.map(o => o.netProfitAda)),
    }))
    .sort((a, b) => b.bestSpread - a.bestSpread)

  const dexPairStats = Array.from(byDexPair.entries())
    .map(([route, spreads]) => ({
      route,
      count: spreads.length,
      avgSpread: spreads.reduce((a, b) => a + b, 0) / spreads.length,
    }))
    .sort((a, b) => b.avgSpread - a.avgSpread)

  const tierCounts = { green: 0, yellow: 0, red: 0 }
  for (const o of opps) tierCounts[o.tier]++

  return (
    <div className="space-y-8 fade-in">
      <h1 className="text-2xl font-bold">📊 Statistics</h1>
      {data.isDemo && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 text-amber-300 text-sm">
          ⚠️ <strong>DEMO DATA</strong> — Statistics based on simulated prices.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Total Opportunities" value={opps.length} />
        <Card label="Profitable (>2%)" value={tierCounts.green} color="text-emerald-400" />
        <Card label="Marginal (1-2%)" value={tierCounts.yellow} color="text-yellow-400" />
        <Card label="Unprofitable (<1%)" value={tierCounts.red} color="text-red-400" />
      </div>

      {/* Most profitable pairs */}
      <Section title="Most Profitable Token Pairs">
        <div className="space-y-2">
          {topPairs.slice(0, 10).map(p => (
            <div key={p.pair} className="flex items-center justify-between bg-slate-800/30 border border-slate-700/30 rounded-lg px-4 py-3">
              <a href={`/pair/${p.pair.split('/')[0]}/${p.pair.split('/')[1]}`} className="font-medium hover:text-blue-400 transition">{p.pair}</a>
              <div className="flex gap-6 text-sm">
                <span className="text-slate-500">{p.count} opps</span>
                <span className="font-mono text-emerald-400">{p.bestSpread.toFixed(2)}% best</span>
                <span className="font-mono text-slate-400">{p.avgSpread.toFixed(2)}% avg</span>
                <span className="font-mono text-emerald-400">{p.bestProfit > 0 ? '+' : ''}{p.bestProfit.toFixed(1)} ₳</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Average spread by DEX pair */}
      <Section title="Average Spread by DEX Route">
        <div className="space-y-2">
          {dexPairStats.map(d => (
            <div key={d.route} className="flex items-center justify-between bg-slate-800/30 border border-slate-700/30 rounded-lg px-4 py-3">
              <span className="font-mono text-sm">{d.route}</span>
              <div className="flex gap-6 text-sm">
                <span className="text-slate-500">{d.count} pairs</span>
                <span className="font-mono text-yellow-400">{d.avgSpread.toFixed(2)}% avg</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Triangular arb stats */}
      {data.triangular.length > 0 && (
        <Section title="Triangular Arbitrage Routes">
          <div className="space-y-2">
            {data.triangular.filter(t => t.profitPct > 0).slice(0, 10).map(t => (
              <div key={t.id} className="flex items-center justify-between bg-slate-800/30 border border-slate-700/30 rounded-lg px-4 py-3 text-sm">
                <span className="font-mono">{t.route.join(' → ')}</span>
                <span className="text-slate-500">{t.dex}</span>
                <span className="font-mono text-emerald-400">{t.profitPct.toFixed(3)}%</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg px-4 py-3">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold font-mono mt-0.5 ${color || 'text-white'}`}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </div>
  )
}
