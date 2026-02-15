'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { ArbOpportunity, ArbResponse, ExecutionPlan, ExecutionConfig, DexStatus } from '@/lib/types'
import { DEX_SWAP_URLS, RISK_LEVELS } from '@/lib/constants'

const defaultConfig: ExecutionConfig = {
  tradeSize: 1000,
  minProfit: 0.5,
  maxSlippage: 2,
  autoExecute: false,
  riskLevel: 'moderate',
}

export default function ExecutePage() {
  const [data, setData] = useState<ArbResponse | null>(null)
  const [config, setConfig] = useState<ExecutionConfig>(defaultConfig)
  const [selectedOpp, setSelectedOpp] = useState<ArbOpportunity | null>(null)
  const [plan, setPlan] = useState<ExecutionPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [countdown, setCountdown] = useState(5)
  const [notified, setNotified] = useState<Set<string>>(new Set())
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const minSpread = RISK_LEVELS[config.riskLevel].minSpread

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`/api/arbitrage?tradeSize=${config.tradeSize}&minSpread=${minSpread}`)
      const json: ArbResponse = await r.json()
      setData(json)

      // Check for high-profit opportunities for notification
      const highProfit = json.opportunities.filter(o => o.spreadPct > 3 && o.netProfitAda > config.minProfit)
      for (const o of highProfit) {
        if (!notified.has(o.id)) {
          try {
            if (audioRef.current) audioRef.current.play().catch(() => {})
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('🚨 High Profit Arb!', {
                body: `${o.pair}: ${o.spreadPct.toFixed(1)}% spread, +${o.netProfitAda.toFixed(2)} ₳ on ${config.tradeSize} ₳`,
              })
            }
          } catch {}
          setNotified(prev => new Set([...prev, o.id]))
        }
      }
    } catch (e) {
      console.error('Fetch error:', e)
    }
  }, [config.tradeSize, minSpread, config.minProfit, notified])

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 5000) // 5s polling for execute page
    return () => clearInterval(iv)
  }, [fetchData])

  useEffect(() => {
    setCountdown(5)
    const iv = setInterval(() => setCountdown(c => (c <= 1 ? 5 : c - 1)), 1000)
    return () => clearInterval(iv)
  }, [data])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const topOpps = data?.opportunities
    .filter(o => o.netProfitAda >= config.minProfit && o.spreadPct >= minSpread)
    .slice(0, 5) || []

  async function generatePlan(opp: ArbOpportunity) {
    setSelectedOpp(opp)
    setPlanLoading(true)
    try {
      const r = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: opp.pair,
          buyDex: opp.buyDex,
          sellDex: opp.sellDex,
          amount: config.tradeSize,
          slippage: config.maxSlippage,
        }),
      })
      const json = await r.json()
      if (json.success) setPlan(json.plan)
    } catch (e) {
      console.error('Plan error:', e)
    } finally {
      setPlanLoading(false)
    }
  }

  return (
    <div className="space-y-6 fade-in">
      {/* Hidden audio for notification sound */}
      <audio ref={audioRef} preload="auto">
        <source src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JkYuGfXN3goqNi4Z/eX6Gi42Lh4B5foWLjouHgXt8g4mMi4eCfHyBh4uLiIN9fICGiouIhH5+gIWJioiEf3+AhYiJiIR/f4CEh4iHhIB/gISHh4eFgICAg4aHhoWBgIGDhYaGhYGBgYOEhYWEgoGCg4SEhISCgYKDg4SEg4KBgoODhISDgoKCg4ODg4OCgoKDg4ODg4KCgoKDg4ODgoKCgoODg4OCgoKCg4ODg4KCgoKDg4ODgoKCgoODg4OCgoKCgoODg4KCgoKCg4ODgoKC" type="audio/wav" />
      </audio>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">⚡ Execute Trades</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Next refresh:</span>
          <span className="font-mono text-blue-400">{countdown}s</span>
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400 pulse-dot" />
        </div>
      </div>

      {data?.isDemo && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 text-amber-300 text-sm">
          ⚠️ <strong>DEMO DATA</strong> — Execution plans are based on simulated prices.
        </div>
      )}

      {/* Config Panel */}
      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">⚙️ Execution Configuration</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Trade Size (ADA)</label>
            <input
              type="range" min={10} max={10000} step={10}
              value={config.tradeSize}
              onChange={e => setConfig({ ...config, tradeSize: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <span className="text-xs font-mono text-blue-400">{config.tradeSize} ₳</span>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Min Profit (ADA)</label>
            <input
              type="number" step="0.1" min={0}
              value={config.minProfit}
              onChange={e => setConfig({ ...config, minProfit: Number(e.target.value) || 0 })}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Max Slippage (%)</label>
            <input
              type="number" step="0.5" min={0} max={20}
              value={config.maxSlippage}
              onChange={e => setConfig({ ...config, maxSlippage: Number(e.target.value) || 2 })}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Risk Level</label>
            <select
              value={config.riskLevel}
              onChange={e => setConfig({ ...config, riskLevel: e.target.value as ExecutionConfig['riskLevel'] })}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full"
            >
              {Object.entries(RISK_LEVELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label} ({v.description})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Auto-Execute</label>
            <div className="flex items-center gap-2 mt-1" title="Coming soon — requires wallet connection">
              <input type="checkbox" disabled checked={false} className="opacity-50" />
              <span className="text-xs text-slate-500">Coming soon</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top 5 Opportunities */}
      <div>
        <h2 className="text-lg font-semibold mb-3">🏆 Top Opportunities</h2>
        {topOpps.length === 0 ? (
          <div className="text-center py-8 text-slate-500 bg-slate-800/20 rounded-lg border border-slate-800">
            No opportunities matching your criteria. Try lowering min profit or switching to Aggressive risk level.
          </div>
        ) : (
          <div className="space-y-3">
            {topOpps.map(o => (
              <div key={o.id} className={`bg-slate-800/30 border rounded-lg p-4 transition ${
                selectedOpp?.id === o.id ? 'border-blue-500/50 bg-blue-900/10' : 'border-slate-700/50 hover:border-slate-600'
              }`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold">{o.pair}</span>
                    <DexBadge dex={o.buyDex} label="Buy" />
                    <span className="text-slate-500">→</span>
                    <DexBadge dex={o.sellDex} label="Sell" />
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={`font-mono font-bold ${o.tier === 'green' ? 'text-emerald-400' : o.tier === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>
                        {o.spreadPct.toFixed(2)}% spread
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatPrice(o.buyPrice)} → {formatPrice(o.sellPrice)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono font-bold ${o.netProfitAda > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {o.netProfitAda > 0 ? '+' : ''}{o.netProfitAda.toFixed(2)} ₳
                      </div>
                      <div className="text-xs text-slate-500">on {config.tradeSize} ₳</div>
                    </div>
                    <button
                      onClick={() => generatePlan(o)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition"
                    >
                      View Plan
                    </button>
                    <div className="relative group">
                      <button
                        disabled
                        className="px-3 py-1.5 bg-slate-700 text-slate-500 rounded text-sm font-medium cursor-not-allowed"
                      >
                        Execute Trade
                      </button>
                      <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none">
                        Connect wallet to enable
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 mt-2 text-xs text-slate-500">
                  <span>Capital: {config.tradeSize} ₳</span>
                  <span>Liquidity: {formatK(Math.min(o.buyLiquidity, o.sellLiquidity))} ₳</span>
                  <span className="text-amber-400">⏱ May disappear in ~20s</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Execution Plan */}
      {(plan || planLoading) && (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-5">
          <h2 className="text-lg font-semibold mb-3">📋 Execution Plan</h2>
          {planLoading ? (
            <div className="text-slate-500 py-4">Generating execution plan...</div>
          ) : plan ? (
            <div className="space-y-4">
              <div className="space-y-2">
                {plan.steps.map(s => (
                  <div key={s.step} className="flex items-start gap-3 bg-slate-900/50 rounded-lg p-3">
                    <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      s.step === plan.steps.length ? 'bg-purple-600' : s.step === 1 ? 'bg-emerald-600' : 'bg-blue-600'
                    }`}>{s.step}</span>
                    <div>
                      <div className="font-medium text-sm">{s.action}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{s.details}</div>
                      {s.estimatedFee > 0 && (
                        <div className="text-xs text-slate-500 mt-0.5">Est. fee: {s.estimatedFee.toFixed(4)} ₳</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Manual execution links */}
              <div className="bg-slate-900/30 rounded-lg p-3">
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Manual Execution Links</div>
                <div className="flex gap-3">
                  <a href={plan.buyDexUrl} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300 underline">
                    Buy on {plan.buyDex} →
                  </a>
                  <a href={plan.sellDexUrl} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300 underline">
                    Sell on {plan.sellDex} →
                  </a>
                </div>
              </div>

              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300/80">
                <strong>⚠️ EUTXO Considerations:</strong> Cardano tx fees ~0.17-0.3 ₳. DEX fees: Minswap 0.3%, SundaeSwap 0.3%, WingRiders 0.35%, MuesliSwap 0.3%.
                Each UTxO can only be consumed once per block — execution timing is critical. Slippage on low-liquidity pairs can eat profits.
              </div>

              <div className="text-xs text-amber-400">
                ⏱ {plan.timeSensitivity}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Data sources */}
      {data?.dexStatuses && (
        <div className="bg-slate-800/20 border border-slate-800 rounded-lg px-4 py-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Data Sources</div>
          <div className="flex flex-wrap gap-3">
            {data.dexStatuses.map((s: DexStatus) => (
              <div key={s.name} className="flex items-center gap-1.5 text-xs">
                <span>{s.status === 'live' ? '🟢' : s.status === 'stale' ? '🟡' : '🔴'}</span>
                <span className="text-slate-300">{s.name}</span>
                {s.pairCount > 0 && <span className="text-slate-500">({s.pairCount})</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const dexColors: Record<string, string> = {
  Minswap: 'bg-blue-500/20 text-blue-300',
  SundaeSwap: 'bg-purple-500/20 text-purple-300',
  WingRiders: 'bg-cyan-500/20 text-cyan-300',
  MuesliSwap: 'bg-amber-500/20 text-amber-300',
}

function DexBadge({ dex, label }: { dex: string; label?: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${dexColors[dex] || 'bg-slate-700 text-slate-300'}`}>
      {label ? `${label}: ` : ''}{dex}
    </span>
  )
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
