'use client'

import { useEffect, useState, useCallback } from 'react'
import { ArbOpportunity, ArbResponse, DexStatus } from '@/lib/types'
import { RISK_LEVELS } from '@/lib/constants'
import { useWallet } from '@/lib/wallet-context'
import { useExecution } from '@/lib/execution-context'
import { TradeSettings, TradeExecution } from '@/lib/trade-engine'

export default function ExecutePage() {
  const wallet = useWallet()
  const exec = useExecution()
  const [data, setData] = useState<ArbResponse | null>(null)
  const [countdown, setCountdown] = useState(5)
  const [showLiveConfirm, setShowLiveConfirm] = useState(false)
  const [showAutoConfirm, setShowAutoConfirm] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`/api/arbitrage?tradeSize=${exec.settings.tradeSize}&minSpread=${exec.settings.minSpread}`)
      const json: ArbResponse = await r.json()
      setData(json)
    } catch (e) {
      console.error('Fetch error:', e)
    }
  }, [exec.settings.tradeSize, exec.settings.minSpread])

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, exec.isAutoTrading ? 10000 : 5000)
    return () => clearInterval(iv)
  }, [fetchData, exec.isAutoTrading])

  useEffect(() => {
    setCountdown(5)
    const iv = setInterval(() => setCountdown(c => (c <= 1 ? 5 : c - 1)), 1000)
    return () => clearInterval(iv)
  }, [data])

  // Auto-trade logic
  useEffect(() => {
    if (!exec.isAutoTrading || !data?.opportunities) return
    if (exec.executionStatus !== 'idle') return

    const now = Date.now()
    const cooldownMs = exec.settings.cooldownSeconds * 1000
    if (now - exec.lastTradeTime < cooldownMs) return
    if (!wallet.connected && !exec.settings.dryRun) return

    const viable = data.opportunities.filter(o =>
      o.spreadPct >= exec.settings.minSpread &&
      o.netProfitAda >= (exec.settings.tradeSize * 0.01 + 0.5) // min 1% + fees
    )

    if (viable.length > 0) {
      exec.executeTrade(viable[0])
    }
  }, [data, exec.isAutoTrading, exec.executionStatus])

  const topOpps = data?.opportunities
    .filter(o => o.netProfitAda >= 0.5 && o.spreadPct >= exec.settings.minSpread)
    .slice(0, 8) || []

  const { settings } = exec

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">⚡ Execute Trades</h1>
        <div className="flex items-center gap-3 text-sm">
          <div className={`px-3 py-1 rounded-full text-xs font-bold ${
            settings.dryRun
              ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'
          }`}>
            {settings.dryRun ? '🟡 DRY RUN' : '🔴 LIVE TRADING'}
          </div>
          <span className="text-slate-500">Refresh:</span>
          <span className="font-mono text-blue-400">{countdown}s</span>
        </div>
      </div>

      {data?.isDemo && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2.5 text-amber-300 text-sm">
          ⚠️ <strong>DEMO DATA</strong> — Prices are simulated. Real trades require live DEX data.
        </div>
      )}

      {/* Wallet not connected warning */}
      {!wallet.connected && !settings.dryRun && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-300 text-sm">
          🔌 <strong>Wallet not connected</strong> — Connect your wallet to execute live trades.
        </div>
      )}

      {/* Status Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <StatusCard
          label="Wallet"
          value={wallet.connected ? `${wallet.balance.toFixed(1)} ₳` : 'Disconnected'}
          color={wallet.connected ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatusCard label="Trades Today" value={exec.dailyPnL.tradeCount.toString()} color="text-blue-400" />
        <StatusCard
          label="Daily P&L"
          value={`${exec.dailyPnL.net > 0 ? '+' : ''}${exec.dailyPnL.net.toFixed(2)} ₳`}
          color={exec.dailyPnL.net >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatusCard
          label="Mode"
          value={exec.isAutoTrading ? 'AUTO' : 'MANUAL'}
          color={exec.isAutoTrading ? 'text-orange-400' : 'text-slate-400'}
        />
        <StatusCard
          label="Status"
          value={exec.executionStatus === 'idle' ? 'Ready' : exec.executionStatus}
          color={exec.executionStatus !== 'idle' ? 'text-yellow-400' : 'text-emerald-400'}
        />
        <StatusCard
          label="Max Trade"
          value={`${settings.tradeSize} ₳`}
          color="text-slate-300"
        />
      </div>

      {/* Active Trade Progress */}
      {exec.activeTrade && (
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full" />
            <h3 className="text-sm font-bold text-blue-400">Active Trade</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
            <div><span className="text-slate-500">Pair:</span> <span className="font-mono">{exec.activeTrade.pair}</span></div>
            <div><span className="text-slate-500">Buy:</span> <span className="font-mono">{exec.activeTrade.buyDex}</span></div>
            <div><span className="text-slate-500">Sell:</span> <span className="font-mono">{exec.activeTrade.sellDex}</span></div>
            <div><span className="text-slate-500">Amount:</span> <span className="font-mono">{exec.activeTrade.amount} ₳</span></div>
            <div><span className="text-slate-500">Mode:</span> <span className="font-mono">{exec.activeTrade.dryRun ? 'DRY RUN' : 'LIVE'}</span></div>
          </div>
          {exec.statusDetail && (
            <div className="mt-2 text-xs text-slate-400">{exec.statusDetail}</div>
          )}
          {exec.activeTrade.buyTxHash && (
            <div className="mt-2 text-xs">
              <a href={`https://cardanoscan.io/transaction/${exec.activeTrade.buyTxHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                Buy TX: {exec.activeTrade.buyTxHash.slice(0, 20)}...
              </a>
            </div>
          )}
        </div>
      )}

      {/* Controls Row */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm hover:bg-slate-700 transition"
        >
          ⚙️ Settings {settingsOpen ? '▲' : '▼'}
        </button>
        <button
          onClick={() => {
            if (settings.dryRun) setShowLiveConfirm(true)
            else exec.updateSettings({ dryRun: true })
          }}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
            settings.dryRun
              ? 'bg-yellow-500/20 border border-yellow-500/30 text-yellow-400'
              : 'bg-red-500/20 border border-red-500/30 text-red-400 animate-pulse'
          }`}
        >
          {settings.dryRun ? '🟡 Switch to LIVE' : '🔴 Switch to DRY RUN'}
        </button>
        <button
          onClick={() => {
            if (!exec.isAutoTrading) setShowAutoConfirm(true)
            else exec.toggleAutoTrade()
          }}
          disabled={!wallet.connected && !settings.dryRun}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
            exec.isAutoTrading
              ? 'bg-orange-500/20 border border-orange-500/30 text-orange-400'
              : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-white'
          } ${!wallet.connected && !settings.dryRun ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {exec.isAutoTrading ? '🤖 AUTO ON — Click to Stop' : '🤖 Enable Auto-Trade'}
        </button>
        {exec.isAutoTrading && (
          <button
            onClick={exec.killSwitch}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-bold"
          >
            🛑 KILL SWITCH
          </button>
        )}
      </div>

      {/* Settings Panel */}
      {settingsOpen && (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-300">⚙️ Trade Settings</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SettingSlider
              label="Max Trade Size (ADA)"
              value={settings.tradeSize}
              min={5} max={200} step={5}
              onChange={v => exec.updateSettings({ tradeSize: v })}
              warn={false}
            />
            <SettingSlider
              label="Min Spread (%)"
              value={settings.minSpread}
              min={0.5} max={10} step={0.5}
              onChange={v => exec.updateSettings({ minSpread: v })}
            />
            <SettingSlider
              label="Max Slippage (%)"
              value={settings.maxSlippage}
              min={0.5} max={5} step={0.5}
              onChange={v => exec.updateSettings({ maxSlippage: v })}
            />
            <SettingSlider
              label="Cooldown (seconds)"
              value={settings.cooldownSeconds}
              min={10} max={300} step={10}
              onChange={v => exec.updateSettings({ cooldownSeconds: v })}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Daily Loss Limit (ADA)</label>
              <input
                type="number" min={10} max={500} step={10}
                value={settings.dailyLossLimit}
                onChange={e => exec.updateSettings({ dailyLossLimit: Number(e.target.value) || 50 })}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Risk Level</label>
              <select
                value={settings.riskLevel}
                onChange={e => exec.updateSettings({ riskLevel: e.target.value as TradeSettings['riskLevel'] })}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full"
              >
                {Object.entries(RISK_LEVELS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label} — {v.description}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-xs text-slate-600 bg-slate-900/50 rounded p-2">
            💡 Safety: Max 1 concurrent trade • Min profit must clear fees + 1% • 10 ADA reserve always maintained • Daily loss limit enforced
          </div>
        </div>
      )}

      {/* Top Opportunities */}
      <div>
        <h2 className="text-lg font-semibold mb-3">🏆 Top Opportunities</h2>
        {topOpps.length === 0 ? (
          <div className="text-center py-8 text-slate-500 bg-slate-800/20 rounded-lg border border-slate-800">
            No opportunities matching criteria.
          </div>
        ) : (
          <div className="space-y-3">
            {topOpps.map(o => (
              <OppCard
                key={o.id}
                opp={o}
                settings={settings}
                onExecute={() => exec.executeTrade(o)}
                executing={exec.executionStatus !== 'idle'}
                walletConnected={wallet.connected}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent Trades */}
      {exec.recentTrades.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">📊 Recent Trades</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase">
                  <th className="text-left px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Pair</th>
                  <th className="text-left px-3 py-2">Route</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-right px-3 py-2">Fees</th>
                  <th className="text-right px-3 py-2">P&L</th>
                  <th className="text-center px-3 py-2">Status</th>
                  <th className="text-center px-3 py-2">TX</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {exec.recentTrades.slice(0, 15).map(t => (
                  <tr key={t.id} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2 font-medium">{t.pair}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{t.buyDex} → {t.sellDex}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">{t.amount} ₳</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{(t.fees || 0).toFixed(2)} ₳</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${t.netProfit > 0 ? 'text-emerald-400' : t.netProfit < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                      {t.netProfit > 0 ? '+' : ''}{t.netProfit.toFixed(2)} ₳
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge status={t.status} dryRun={t.dryRun} />
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
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
        </div>
      )}

      {/* Data Sources */}
      {data?.dexStatuses && (
        <div className="bg-slate-800/20 border border-slate-800 rounded-lg px-4 py-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Data Sources</div>
          <div className="flex flex-wrap gap-3">
            {data.dexStatuses.map((s: DexStatus) => (
              <div key={s.name} className="flex items-center gap-1.5 text-xs">
                <span>{s.status === 'live' ? '🟢' : s.status === 'stale' ? '🟡' : '🔴'}</span>
                <span className="text-slate-300">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showLiveConfirm && (
        <Modal onClose={() => setShowLiveConfirm(false)}>
          <div className="text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h3 className="text-lg font-bold text-red-400 mb-2">Switch to LIVE Trading?</h3>
            <p className="text-sm text-slate-400 mb-4">
              This will execute <strong>real transactions</strong> with <strong>real ADA</strong> from your connected wallet.
              You could lose money.
            </p>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-xs text-red-300 text-left space-y-1">
              <div>• Max trade size: {settings.tradeSize} ADA</div>
              <div>• Daily loss limit: {settings.dailyLossLimit} ADA</div>
              <div>• Slippage protection: {settings.maxSlippage}%</div>
              <div>• 10 ADA reserve always maintained</div>
              <div>• Transactions require wallet signature approval</div>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setShowLiveConfirm(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm">Cancel</button>
              <button
                onClick={() => { exec.updateSettings({ dryRun: false }); setShowLiveConfirm(false) }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-bold"
              >
                ⚡ Enable LIVE Mode
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showAutoConfirm && (
        <Modal onClose={() => setShowAutoConfirm(false)}>
          <div className="text-center">
            <div className="text-4xl mb-3">🤖</div>
            <h3 className="text-lg font-bold text-orange-400 mb-2">Enable Auto-Trading?</h3>
            <p className="text-sm text-slate-400 mb-4">
              The bot will automatically execute when profitable opportunities are found.
              {settings.dryRun ? ' Currently DRY RUN — no real trades.' : ' ⚠️ LIVE MODE — real ADA!'}
            </p>
            <div className="bg-slate-800 rounded-lg p-3 mb-4 text-xs text-slate-300 text-left space-y-1">
              <div>• Max trade: {settings.tradeSize} ADA</div>
              <div>• Min spread: {settings.minSpread}%</div>
              <div>• Cooldown: {settings.cooldownSeconds}s between trades</div>
              <div>• Daily loss limit: {settings.dailyLossLimit} ADA</div>
              <div>• Mode: {settings.dryRun ? '🟡 DRY RUN' : '🔴 LIVE'}</div>
              <div>• Kill switch available at all times</div>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setShowAutoConfirm(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm">Cancel</button>
              <button
                onClick={() => { exec.toggleAutoTrade(); setShowAutoConfirm(false) }}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm font-bold"
              >
                🤖 Enable Auto-Trade
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Components ───

function OppCard({ opp, settings, onExecute, executing, walletConnected }: {
  opp: ArbOpportunity
  settings: TradeSettings
  onExecute: () => void
  executing: boolean
  walletConnected: boolean
}) {
  const estimatedFees = 0.5
  const minProfit = estimatedFees + (settings.tradeSize * 0.01)
  const profitable = opp.netProfitAda >= minProfit

  return (
    <div className={`bg-slate-800/30 border rounded-lg p-4 transition ${
      profitable ? 'border-emerald-500/30 hover:border-emerald-500/50' : 'border-slate-700/50 hover:border-slate-600'
    }`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">{opp.pair}</span>
          <DexBadge dex={opp.buyDex} label="Buy" />
          <span className="text-slate-500">→</span>
          <DexBadge dex={opp.sellDex} label="Sell" />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className={`font-mono font-bold ${opp.tier === 'green' ? 'text-emerald-400' : opp.tier === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>
              {opp.spreadPct.toFixed(2)}% spread
            </div>
            <div className="text-xs text-slate-500">
              {formatPrice(opp.buyPrice)} → {formatPrice(opp.sellPrice)}
            </div>
          </div>
          <div className="text-right">
            <div className={`font-mono font-bold ${opp.netProfitAda > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {opp.netProfitAda > 0 ? '+' : ''}{opp.netProfitAda.toFixed(2)} ₳
            </div>
            <div className="text-xs text-slate-500">on {settings.tradeSize} ₳</div>
          </div>
          <button
            onClick={onExecute}
            disabled={executing || (!walletConnected && !settings.dryRun)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
              profitable && (walletConnected || settings.dryRun)
                ? settings.dryRun
                  ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            } ${executing ? 'opacity-50' : ''}`}
          >
            {settings.dryRun ? '🧪 Dry Run' : '⚡ Execute'}
          </button>
        </div>
      </div>
      <div className="flex gap-4 mt-2 text-xs text-slate-500">
        <span>Capital: {settings.tradeSize} ₳</span>
        <span>Liq: {formatK(Math.min(opp.buyLiquidity, opp.sellLiquidity))} ₳</span>
        <span>Est. fees: ~{estimatedFees.toFixed(2)} ₳</span>
        {!profitable && <span className="text-red-400">Below min profit threshold</span>}
      </div>
    </div>
  )
}

function SettingSlider({ label, value, min, max, step, onChange, warn, warnText }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; warn?: boolean; warnText?: string
}) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
      <div className="flex justify-between">
        <span className="text-xs font-mono text-blue-400">{value}</span>
        {warn && <span className="text-[10px] text-amber-400">{warnText}</span>}
      </div>
    </div>
  )
}

function StatusBadge({ status, dryRun }: { status: string; dryRun: boolean }) {
  const colors: Record<string, string> = {
    completed: 'bg-emerald-500/20 text-emerald-300',
    'dry-run': 'bg-yellow-500/20 text-yellow-300',
    failed: 'bg-red-500/20 text-red-300',
    pending: 'bg-blue-500/20 text-blue-300',
    buying: 'bg-blue-500/20 text-blue-300',
    selling: 'bg-purple-500/20 text-purple-300',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-slate-700 text-slate-300'}`}>
      {dryRun ? '🧪 ' : ''}{status}
    </span>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111827] border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        {children}
      </div>
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
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${dexColors[dex] || 'bg-slate-700 text-slate-300'}`}>{label ? `${label}: ` : ''}{dex}</span>
}

function StatusCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg px-3 py-2">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold font-mono mt-0.5 ${color || 'text-white'}`}>{value}</div>
    </div>
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
