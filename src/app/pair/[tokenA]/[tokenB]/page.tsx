'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArbOpportunity, TokenPrice } from '@/lib/types'

export default function PairDetailPage() {
  const params = useParams()
  const tokenA = params.tokenA as string
  const tokenB = params.tokenB as string
  const pair = `${tokenA}/${tokenB}`

  const [prices, setPrices] = useState<TokenPrice[]>([])
  const [opps, setOpps] = useState<ArbOpportunity[]>([])
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    async function load() {
      const [priceRes, arbRes] = await Promise.all([
        fetch('/api/prices').then(r => r.json()),
        fetch('/api/arbitrage').then(r => r.json()),
      ])
      setPrices(priceRes.prices.filter((p: TokenPrice) => p.pair === pair))
      setOpps(arbRes.opportunities.filter((o: ArbOpportunity) => o.pair === pair))
      setIsDemo(priceRes.isDemo)
    }
    load()
    const iv = setInterval(load, 15000)
    return () => clearInterval(iv)
  }, [pair])

  const bestBuy = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null
  const bestSell = prices.length ? prices.reduce((a, b) => a.price > b.price ? a : b) : null

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center gap-3">
        <a href="/" className="text-slate-500 hover:text-white text-sm">← Back</a>
        <h1 className="text-2xl font-bold">{pair}</h1>
        {isDemo && <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">DEMO</span>}
      </div>

      {/* Price across DEXs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {prices.map(p => (
          <div key={p.dex} className={`bg-slate-800/40 border rounded-lg px-4 py-3 ${
            p.dex === bestBuy?.dex ? 'border-emerald-500/50' : p.dex === bestSell?.dex ? 'border-blue-500/50' : 'border-slate-700/50'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{p.dex}</span>
              {p.dex === bestBuy?.dex && <span className="text-xs text-emerald-400">Best Buy</span>}
              {p.dex === bestSell?.dex && bestSell?.dex !== bestBuy?.dex && <span className="text-xs text-blue-400">Best Sell</span>}
            </div>
            <div className="text-xl font-mono font-bold mt-1">{formatPrice(p.price)}</div>
            <div className="text-xs text-slate-500 mt-1">Liquidity: {(p.liquidity / 1000).toFixed(1)}K ₳</div>
          </div>
        ))}
        {prices.length === 0 && <div className="col-span-4 text-slate-500 text-center py-8">Loading price data...</div>}
      </div>

      {/* Execution Plan */}
      {bestBuy && bestSell && bestBuy.dex !== bestSell.dex && (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-3">📋 Execution Plan (1000 ₳ trade)</h2>
          <div className="space-y-2 text-sm font-mono">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">1.</span>
              <span>Buy {tokenB} on <strong>{bestBuy.dex}</strong> at {formatPrice(bestBuy.price)} ₳/{tokenB}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-400">2.</span>
              <span>Sell {tokenB} on <strong>{bestSell.dex}</strong> at {formatPrice(bestSell.price)} ₳/{tokenB}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-purple-400">3.</span>
              <span>Spread: <strong className="text-yellow-400">{(((bestSell.price - bestBuy.price) / bestBuy.price) * 100).toFixed(2)}%</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-amber-400">4.</span>
              <span>Est. gross profit: <strong className="text-emerald-400">
                {((1000 / bestBuy.price * bestSell.price) - 1000).toFixed(2)} ₳
              </strong> (before fees ~1.1% + 0.5₳ tx)</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            ⚠️ EUTXO model: Execution requires batching/chaining UTXOs. Slippage and pool state changes may affect actual results.
          </div>
        </div>
      )}

      {/* Arb history for this pair */}
      {opps.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Current Arbitrage Opportunities</h2>
          <div className="space-y-2">
            {opps.map(o => (
              <div key={o.id} className="flex items-center justify-between bg-slate-800/30 border border-slate-700/30 rounded-lg px-4 py-2.5 text-sm">
                <span>{o.buyDex} → {o.sellDex}</span>
                <span className={`font-mono font-semibold ${o.spreadPct > 2 ? 'text-emerald-400' : o.spreadPct > 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {o.spreadPct.toFixed(2)}%
                </span>
                <span className="font-mono text-slate-400">{o.netProfitAda > 0 ? '+' : ''}{o.netProfitAda.toFixed(2)} ₳</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatPrice(p: number) {
  if (p < 0.0001) return p.toExponential(2)
  if (p < 1) return p.toFixed(6)
  return p.toFixed(4)
}
