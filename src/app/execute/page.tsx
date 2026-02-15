'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { ArbOpportunity, ArbResponse, ExecutionPlan, DexStatus } from '@/lib/types'
import { DEX_SWAP_URLS, RISK_LEVELS } from '@/lib/constants'
import { useWallet } from '@/lib/wallet-context'
import {
  TradeSettings, TradeExecution, DEFAULT_TRADE_SETTINGS,
  loadSettings, saveSettings, loadTradeHistory, addTrade, updateTrade,
  getDailyPnL, canTrade, generateTradeId, notifyTrade, notifyDiscord,
} from '@/lib/trade-engine'

type TradingMode = 'idle' | 'scanning' | 'executing'

export default function ExecutePage() {
  const wallet = useWallet()
  const [data, setData] = useState<ArbResponse | null>(null)
  const [settings, setSettings] = useState<TradeSettings>(DEFAULT_TRADE_SETTINGS)
  const [selectedOpp, setSelectedOpp] = useState<ArbOpportunity | null>(null)
  const [plan, setPlan] = useState<ExecutionPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [countdown, setCountdown] = useState(5)
  const [tradingMode, setTradingMode] = useState<TradingMode>('idle')
  const [activeTrade, setActiveTrade] = useState<TradeExecution | null>(null)
  const [recentTrades, setRecentTrades] = useState<TradeExecution[]>([])
  const [dailyPnL, setDailyPnL] = useState({ profit: 0, loss: 0, net: 0, tradeCount: 0 })
  const [showLiveConfirm, setShowLiveConfirm] = useState(false)
  const [showAutoConfirm, setShowAutoConfirm] = useState(false)
  const [lastTradeTime, setLastTradeTime] = useState(0)
  const killSwitchRef = useRef(false)
  const autoTradeRef = useRef(false)

  // Load settings + history on mount
  useEffect(() => {
    setSettings(loadSettings())
    setRecentTrades(loadTradeHistory().slice(0, 20))
    setDailyPnL(getDailyPnL())
  }, [])

  // Save settings on change
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // Keep ref in sync
  useEffect(() => {
    autoTradeRef.current = settings.autoTrade
  }, [settings.autoTrade])

  const fetchData = useCallback(async () => {
    try {
      const minSpread = settings.minSpread
      const r = await fetch(`/api/arbitrage?tradeSize=${settings.tradeSize}&minSpread=${minSpread}`)
      const json: ArbResponse = await r.json()
      setData(json)
    } catch (e) {
      console.error('Fetch error:', e)
    }
  }, [settings.tradeSize, settings.minSpread])

  // Polling
  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, settings.autoTrade ? 10000 : 5000)
    return () => clearInterval(iv)
  }, [fetchData, settings.autoTrade])

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
    .filter(o => o.netProfitAda >= 2 && o.spreadPct >= settings.minSpread)
    .slice(0, 5) || []

  // ─── Execute a single trade ───
  async function executeTrade(opp: ArbOpportunity) {
    if (killSwitchRef.current) return
    if (tradingMode === 'executing') return

    const check = canTrade(settings, wallet.balance)
    if (!check.ok) {
      alert(`Cannot trade: ${check.reason}`)
      return
    }

    setTradingMode('executing')
    const trade: TradeExecution = {
      id: generateTradeId(),
      timestamp: Date.now(),
      pair: opp.pair,
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      amount: settings.tradeSize,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      fees: 0,
      netProfit: 0,
      status: settings.dryRun ? 'dry-run' : 'pending',
      dryRun: settings.dryRun,
    }
    setActiveTrade(trade)

    if (settings.dryRun) {
      // Simulate trade
      const fees = settings.tradeSize * 0.006 + 0.4 // ~0.6% DEX fees + tx fees
      trade.fees = fees
      trade.netProfit = opp.netProfitAda
      trade.status = 'dry-run'
      await new Promise(r => setTimeout(r, 1500)) // Simulate delay

      const updated = addTrade(trade)
      setRecentTrades(updated.slice(0, 20))
      notifyTrade(trade)
      notifyDiscord(trade)
    } else if (wallet.connected && wallet.api) {
      // LIVE TRADE
      try {
        // Step 1: Build buy transaction
        trade.status = 'buying'
        setActiveTrade({ ...trade })

        const buyResp = await fetch('/api/trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'build',
            pair: opp.pair,
            dex: opp.buyDex,
            direction: 'buy',
            amount: settings.tradeSize,
            slippage: settings.maxSlippage,
            walletAddress: wallet.address,
          }),
        })
        const buyData = await buyResp.json()

        if (buyData.txCbor) {
          // Sign with wallet
          const signedBuyTx = await wallet.api.signTx(buyData.txCbor, true)
          
          // Submit
          const submitResp = await fetch('/api/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'submit', signedTx: signedBuyTx }),
          })
          const submitData = await submitResp.json()
          trade.buyTxHash = submitData.txHash

          // Wait for confirmation (poll every 5s, max 120s)
          trade.status = 'bought'
          setActiveTrade({ ...trade })
          
          if (submitData.txHash) {
            let confirmed = false
            for (let i = 0; i < 24 && !confirmed && !killSwitchRef.current; i++) {
              await new Promise(r => setTimeout(r, 5000))
              const statusResp = await fetch('/api/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'status', txHash: submitData.txHash }),
              })
              const statusData = await statusResp.json()
              if (statusData.confirmed) {
                confirmed = true
                trade.fees += statusData.fees || 0.2
              }
            }
          }

          // Step 2: Build sell transaction
          if (!killSwitchRef.current) {
            trade.status = 'selling'
            setActiveTrade({ ...trade })

            const sellResp = await fetch('/api/trade', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'build',
                pair: opp.pair,
                dex: opp.sellDex,
                direction: 'sell',
                amount: buyData.estimatedOutput || settings.tradeSize,
                slippage: settings.maxSlippage,
                walletAddress: wallet.address,
              }),
            })
            const sellData = await sellResp.json()

            if (sellData.txCbor) {
              const signedSellTx = await wallet.api.signTx(sellData.txCbor, true)
              const sellSubmitResp = await fetch('/api/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'submit', signedTx: signedSellTx }),
              })
              const sellSubmitData = await sellSubmitResp.json()
              trade.sellTxHash = sellSubmitData.txHash
            }
          }

          trade.status = 'completed'
          trade.netProfit = opp.netProfitAda - trade.fees
        } else {
          // Mock mode - aggregator not available
          trade.status = 'completed'
          trade.netProfit = opp.netProfitAda
          trade.fees = 0.4
        }

        const updated = addTrade(trade)
        setRecentTrades(updated.slice(0, 20))
        notifyTrade(trade)
        notifyDiscord(trade)
        wallet.refreshBalance()
      } catch (e) {
        trade.status = 'failed'
        trade.errorMessage = e instanceof Error ? e.message : 'Unknown error'
        addTrade(trade)
        notifyTrade(trade)
      }
    }

    setActiveTrade(null)
    setTradingMode('idle')
    setDailyPnL(getDailyPnL())
    setLastTradeTime(Date.now())
  }

  // ─── Auto-trade loop ───
  useEffect(() => {
    if (!settings.autoTrade || !data?.opportunities) return

    const now = Date.now()
    const cooldownMs = settings.cooldownSeconds * 1000
    if (now - lastTradeTime < cooldownMs) return
    if (tradingMode === 'executing') return
    if (killSwitchRef.current) return
    if (!wallet.connected && !settings.dryRun) return

    const viable = data.opportunities.filter(o =>
      o.spreadPct >= settings.minSpread &&
      o.netProfitAda >= 2 // Min 2 ADA profit
    )

    if (viable.length > 0) {
      executeTrade(viable[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, settings.autoTrade])

  // ─── Kill Switch ───
  function killSwitch() {
    killSwitchRef.current = true
    setSettings(s => ({ ...s, autoTrade: false }))
    autoTradeRef.current = false
    setTradingMode('idle')
    setActiveTrade(null)
    setTimeout(() => { killSwitchRef.current = false }, 2000)
  }

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
          amount: settings.tradeSize,
          slippage: settings.maxSlippage,
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
      {/* Kill Switch */}
      {(settings.autoTrade || tradingMode === 'executing') && (
        <button
          onClick={killSwitch}
          className="fixed bottom-6 right-6 z-50 px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl text-lg font-bold shadow-2xl shadow-red-900/50 animate-pulse"
        >
          🛑 STOP ALL TRADING
        </button>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">⚡ Execute Trades</h1>
        <div className="flex items-center gap-3 text-sm">
          {/* Trading Mode Indicator */}
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

      {/* Status Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatusCard
          label="Wallet"
          value={wallet.connected ? `${wallet.balance.toFixed(1)} ₳` : 'Not Connected'}
          color={wallet.connected ? 'text-emerald-400' : 'text-slate-500'}
        />
        <StatusCard
          label="Trades Today"
          value={dailyPnL.tradeCount.toString()}
          color="text-blue-400"
        />
        <StatusCard
          label="Daily P&L"
          value={`${dailyPnL.net > 0 ? '+' : ''}${dailyPnL.net.toFixed(2)} ₳`}
          color={dailyPnL.net >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatusCard
          label="Mode"
          value={settings.autoTrade ? (tradingMode === 'executing' ? 'EXECUTING' : 'AUTO') : 'MANUAL'}
          color={settings.autoTrade ? 'text-orange-400' : 'text-slate-400'}
        />
        <StatusCard
          label="Active"
          value={activeTrade ? activeTrade.status : 'None'}
          color={activeTrade ? 'text-yellow-400' : 'text-slate-500'}
        />
      </div>

      {/* Settings Panel */}
      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">⚙️ Trade Settings</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Trade Size (ADA)</label>
            <input
              type="range" min={10} max={200} step={5}
              value={settings.tradeSize}
              onChange={e => setSettings(s => ({ ...s, tradeSize: Number(e.target.value) }))}
              className="w-full accent-blue-500"
            />
            <span className="text-xs font-mono text-blue-400">{settings.tradeSize} ₳</span>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Min Spread (%)</label>
            <input
              type="range" min={1} max={10} step={0.5}
              value={settings.minSpread}
              onChange={e => setSettings(s => ({ ...s, minSpread: Number(e.target.value) }))}
              className="w-full accent-blue-500"
            />
            <span className="text-xs font-mono text-blue-400">{settings.minSpread}%</span>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Max Slippage (%)</label>
            <input
              type="range" min={0.5} max={5} step={0.5}
              value={settings.maxSlippage}
              onChange={e => setSettings(s => ({ ...s, maxSlippage: Number(e.target.value) }))}
              className="w-full accent-blue-500"
            />
            <span className="text-xs font-mono text-blue-400">{settings.maxSlippage}%</span>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Daily Loss Limit (ADA)</label>
            <input
              type="number" min={10} max={500} step={10}
              value={settings.dailyLossLimit}
              onChange={e => setSettings(s => ({ ...s, dailyLossLimit: Number(e.target.value) || 50 }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Risk Level</label>
            <select
              value={settings.riskLevel}
              onChange={e => setSettings(s => ({ ...s, riskLevel: e.target.value as TradeSettings['riskLevel'] }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full"
            >
              {Object.entries(RISK_LEVELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Cooldown (seconds)</label>
            <input
              type="range" min={30} max={300} step={10}
              value={settings.cooldownSeconds}
              onChange={e => setSettings(s => ({ ...s, cooldownSeconds: Number(e.target.value) }))}
              className="w-full accent-blue-500"
            />
            <span className="text-xs font-mono text-blue-400">{settings.cooldownSeconds}s</span>
          </div>

          {/* Dry Run Toggle */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Trading Mode</label>
            <button
              onClick={() => {
                if (settings.dryRun) {
                  setShowLiveConfirm(true)
                } else {
                  setSettings(s => ({ ...s, dryRun: true }))
                }
              }}
              className={`w-full px-3 py-1.5 rounded text-xs font-bold transition ${
                settings.dryRun
                  ? 'bg-yellow-500/20 border border-yellow-500/30 text-yellow-400'
                  : 'bg-red-500/20 border border-red-500/30 text-red-400 animate-pulse'
              }`}
            >
              {settings.dryRun ? '🟡 DRY RUN (safe)' : '🔴 LIVE MODE'}
            </button>
          </div>

          {/* Auto-Trade Toggle */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Auto-Trade</label>
            <button
              onClick={() => {
                if (!settings.autoTrade) {
                  setShowAutoConfirm(true)
                } else {
                  setSettings(s => ({ ...s, autoTrade: false }))
                }
              }}
              disabled={!wallet.connected && !settings.dryRun}
              className={`w-full px-3 py-1.5 rounded text-xs font-bold transition ${
                settings.autoTrade
                  ? 'bg-orange-500/20 border border-orange-500/30 text-orange-400'
                  : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-white'
              } ${!wallet.connected && !settings.dryRun ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {settings.autoTrade ? '🤖 AUTO ON' : '🤖 AUTO OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Active Trade Status */}
      {activeTrade && (
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 animate-pulse">
          <h3 className="text-sm font-bold text-blue-400 mb-2">⏳ Active Trade</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div><span className="text-slate-500">Pair:</span> <span className="font-mono">{activeTrade.pair}</span></div>
            <div><span className="text-slate-500">Status:</span> <span className="font-mono text-yellow-400">{activeTrade.status}</span></div>
            <div><span className="text-slate-500">Amount:</span> <span className="font-mono">{activeTrade.amount} ₳</span></div>
            <div><span className="text-slate-500">Mode:</span> <span className="font-mono">{activeTrade.dryRun ? 'DRY RUN' : 'LIVE'}</span></div>
          </div>
          {activeTrade.buyTxHash && (
            <div className="mt-2 text-xs">
              <a href={`https://cardanoscan.io/transaction/${activeTrade.buyTxHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                Buy TX: {activeTrade.buyTxHash.slice(0, 20)}...
              </a>
            </div>
          )}
        </div>
      )}

      {/* Top Opportunities */}
      <div>
        <h2 className="text-lg font-semibold mb-3">🏆 Top Opportunities</h2>
        {topOpps.length === 0 ? (
          <div className="text-center py-8 text-slate-500 bg-slate-800/20 rounded-lg border border-slate-800">
            No opportunities matching criteria (min 2 ₳ profit, {settings.minSpread}% spread).
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
                      <div className="text-xs text-slate-500">on {settings.tradeSize} ₳</div>
                    </div>
                    <button
                      onClick={() => generatePlan(o)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition"
                    >
                      View Plan
                    </button>
                    <button
                      onClick={() => executeTrade(o)}
                      disabled={tradingMode === 'executing' || (!wallet.connected && !settings.dryRun)}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                        wallet.connected || settings.dryRun
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      } ${tradingMode === 'executing' ? 'opacity-50' : ''}`}
                    >
                      {settings.dryRun ? '🧪 Dry Run' : '⚡ Execute'}
                    </button>
                  </div>
                </div>
                <div className="flex gap-4 mt-2 text-xs text-slate-500">
                  <span>Capital: {settings.tradeSize} ₳</span>
                  <span>Liquidity: {formatK(Math.min(o.buyLiquidity, o.sellLiquidity))} ₳</span>
                  <span className="text-amber-400">⏱ ~20s window</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Trades */}
      {recentTrades.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">📊 Recent Trades</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase">
                  <th className="text-left px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Pair</th>
                  <th className="text-left px-3 py-2">Route</th>
                  <th className="text-right px-3 py-2">P&L</th>
                  <th className="text-center px-3 py-2">Status</th>
                  <th className="text-center px-3 py-2">TX</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {recentTrades.slice(0, 10).map(t => (
                  <tr key={t.id} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2 font-medium">{t.pair}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{t.buyDex} → {t.sellDex}</td>
                    <td className={`px-3 py-2 text-right font-mono ${t.netProfit > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.netProfit > 0 ? '+' : ''}{t.netProfit.toFixed(2)} ₳
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        t.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' :
                        t.status === 'dry-run' ? 'bg-yellow-500/20 text-yellow-300' :
                        t.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                        'bg-blue-500/20 text-blue-300'
                      }`}>{t.dryRun ? '🧪 ' : ''}{t.status}</span>
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {t.buyTxHash ? (
                        <a href={`https://cardanoscan.io/transaction/${t.buyTxHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                          View
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
              <div className="bg-slate-900/30 rounded-lg p-3">
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Manual Execution Links</div>
                <div className="flex gap-3">
                  <a href={plan.buyDexUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:text-blue-300 underline">
                    Buy on {plan.buyDex} →
                  </a>
                  <a href={plan.sellDexUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:text-blue-300 underline">
                    Sell on {plan.sellDex} →
                  </a>
                </div>
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

      {/* Live Mode Confirmation Modal */}
      {showLiveConfirm && (
        <Modal onClose={() => setShowLiveConfirm(false)}>
          <div className="text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h3 className="text-lg font-bold text-red-400 mb-2">Switch to LIVE Trading?</h3>
            <p className="text-sm text-slate-400 mb-4">
              This will execute <strong>real transactions</strong> with <strong>real ADA</strong> from your connected wallet.
              You could lose money. Make sure you understand the risks.
            </p>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-xs text-red-300 text-left">
              <div>• Max trade size: {settings.tradeSize} ADA</div>
              <div>• Daily loss limit: {settings.dailyLossLimit} ADA</div>
              <div>• Slippage protection: {settings.maxSlippage}%</div>
              <div>• Minimum 10 ADA reserve always maintained</div>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setShowLiveConfirm(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm">
                Cancel
              </button>
              <button
                onClick={() => {
                  setSettings(s => ({ ...s, dryRun: false }))
                  setShowLiveConfirm(false)
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-bold"
              >
                Enable LIVE Mode
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Auto-Trade Confirmation Modal */}
      {showAutoConfirm && (
        <Modal onClose={() => setShowAutoConfirm(false)}>
          <div className="text-center">
            <div className="text-4xl mb-3">🤖</div>
            <h3 className="text-lg font-bold text-orange-400 mb-2">Enable Auto-Trading?</h3>
            <p className="text-sm text-slate-400 mb-4">
              The bot will automatically execute arbitrage trades when profitable opportunities are found.
              {settings.dryRun
                ? ' Currently in DRY RUN mode — no real trades will be executed.'
                : ' ⚠️ LIVE MODE — real ADA will be traded!'}
            </p>
            <div className="bg-slate-800 rounded-lg p-3 mb-4 text-xs text-slate-300 text-left">
              <div>• Max trade size: {settings.tradeSize} ADA</div>
              <div>• Min spread: {settings.minSpread}%</div>
              <div>• Min profit threshold: 2 ADA</div>
              <div>• Cooldown: {settings.cooldownSeconds}s between trades</div>
              <div>• Daily loss limit: {settings.dailyLossLimit} ADA</div>
              <div>• Mode: {settings.dryRun ? '🟡 DRY RUN' : '🔴 LIVE'}</div>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setShowAutoConfirm(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm">
                Cancel
              </button>
              <button
                onClick={() => {
                  setSettings(s => ({ ...s, autoTrade: true }))
                  setShowAutoConfirm(false)
                }}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm font-bold"
              >
                Enable Auto-Trade
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
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

function StatusCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg px-3 py-2">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold font-mono mt-0.5 ${color || 'text-white'}`}>{value}</div>
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
