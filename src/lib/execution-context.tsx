'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'
import { useWallet } from './wallet-context'
import { ArbOpportunity } from './types'
import {
  TradeSettings, TradeExecution, DEFAULT_TRADE_SETTINGS,
  loadSettings, saveSettings, loadTradeHistory, addTrade, updateTrade,
  getDailyPnL, canTrade, generateTradeId, notifyTrade, notifyDiscord,
} from './trade-engine'
import { executeArbitrage } from './swap-executor'

// Server wallet info
interface ServerWalletInfo {
  configured: boolean
  address: string
  addressTruncated: string
  balanceAda: number
  autoSign: boolean
}

async function executeServerSide(params: {
  pair: string; buyDex: string; sellDex: string; amountAda: number; slippagePct: number;
  onStatus: (status: string, detail?: string) => void;
}): Promise<{ success: boolean; buyTxHash?: string; sellTxHash?: string; totalFees: number; netProfitAda?: number; error?: string }> {
  const { pair, buyDex, sellDex, amountAda, slippagePct, onStatus } = params
  const [tokenA, tokenB] = pair.split('/')

  // Use the server-side arbitrage mode which handles both legs atomically
  onStatus('building-buy', `Server executing arb: ${amountAda} ADA → ${tokenB} → ADA`)
  
  const resp = await fetch('/api/trade/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'arbitrage',
      tokenPair: `${tokenA}/${tokenB}`,
      amount: amountAda,
      slippage: slippagePct,
      buyDex,
      sellDex,
    }),
  })
  const data = await resp.json()
  
  if (!data.success) {
    return {
      success: false,
      buyTxHash: data.buyTxHash,
      totalFees: 0.4,
      error: data.error,
    }
  }

  onStatus('completed', `Arb complete! Buy: ${data.buyTxHash?.slice(0, 8)}... Sell: ${data.sellTxHash?.slice(0, 8)}... Profit: ${data.netProfitAda?.toFixed(2)} ADA`)
  return {
    success: true,
    buyTxHash: data.buyTxHash,
    sellTxHash: data.sellTxHash,
    totalFees: 0.4,
    netProfitAda: data.netProfitAda,
  }
}

export type ExecutionStatus = 'idle' | 'building-buy' | 'signing-buy' | 'confirming-buy' | 'building-sell' | 'signing-sell' | 'confirming-sell' | 'completed' | 'failed'

interface ExecutionState {
  settings: TradeSettings
  updateSettings: (s: Partial<TradeSettings>) => void
  activeTrade: TradeExecution | null
  executionStatus: ExecutionStatus
  statusDetail: string
  recentTrades: TradeExecution[]
  dailyPnL: { profit: number; loss: number; net: number; tradeCount: number }
  isAutoTrading: boolean
  lastTradeTime: number
  serverWallet: ServerWalletInfo | null
  // Actions
  executeTrade: (opp: ArbOpportunity) => Promise<void>
  killSwitch: () => void
  toggleAutoTrade: () => void
  refreshPnL: () => void
  refreshServerWallet: () => void
}

const ExecutionContext = createContext<ExecutionState>(null!)

export function useExecution() {
  return useContext(ExecutionContext)
}

export function ExecutionProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const [settings, setSettingsState] = useState<TradeSettings>(() => loadSettings())
  const [activeTrade, setActiveTrade] = useState<TradeExecution | null>(null)
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle')
  const [statusDetail, setStatusDetail] = useState('')
  const [recentTrades, setRecentTrades] = useState<TradeExecution[]>(() => loadTradeHistory().slice(0, 50))
  const [dailyPnL, setDailyPnL] = useState(() => getDailyPnL())
  const [lastTradeTime, setLastTradeTime] = useState(0)
  const [serverWallet, setServerWallet] = useState<ServerWalletInfo | null>(null)
  const killRef = useRef(false)

  const refreshServerWallet = useCallback(async () => {
    try {
      const resp = await fetch('/api/wallet/info')
      const data = await resp.json()
      setServerWallet(data)
    } catch {
      setServerWallet(null)
    }
  }, [])

  // Fetch server wallet info on mount and periodically
  useEffect(() => {
    refreshServerWallet()
    const iv = setInterval(refreshServerWallet, 60000)
    return () => clearInterval(iv)
  }, [refreshServerWallet])

  const updateSettings = useCallback((partial: Partial<TradeSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...partial }
      saveSettings(next)
      return next
    })
  }, [])

  const refreshPnL = useCallback(() => {
    setDailyPnL(getDailyPnL())
    setRecentTrades(loadTradeHistory().slice(0, 50))
  }, [])

  const killSwitch = useCallback(() => {
    killRef.current = true
    setSettingsState(prev => {
      const next = { ...prev, autoTrade: false }
      saveSettings(next)
      return next
    })
    setExecutionStatus('idle')
    setActiveTrade(null)
    setStatusDetail('KILLED — all trading stopped')
    setTimeout(() => { killRef.current = false }, 3000)
  }, [])

  const toggleAutoTrade = useCallback(() => {
    setSettingsState(prev => {
      const next = { ...prev, autoTrade: !prev.autoTrade }
      saveSettings(next)
      return next
    })
  }, [])

  const executeTrade = useCallback(async (opp: ArbOpportunity) => {
    if (killRef.current) return
    if (executionStatus !== 'idle') return

    // Use server wallet balance if available, otherwise browser wallet
    const effectiveBalance = serverWallet?.configured ? serverWallet.balanceAda : wallet.balance

    // Safety checks
    const check = canTrade(settings, effectiveBalance)
    if (!check.ok) {
      setStatusDetail(`Cannot trade: ${check.reason}`)
      return
    }

    // Cooldown check
    const now = Date.now()
    const cooldownMs = settings.cooldownSeconds * 1000
    if (now - lastTradeTime < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (now - lastTradeTime)) / 1000)
      setStatusDetail(`Cooldown: ${remaining}s remaining`)
      return
    }

    // Min profit check (must clear fees + 1%)
    // Real round-trip fees: ~3.8 ADA per swap × 2 swaps = ~7.6 ADA + slippage buffer
    const estimatedFees = 8.0
    const minProfitRequired = estimatedFees + (settings.tradeSize * 0.01) // fees + 1% of trade size
    if (opp.netProfitAda < minProfitRequired) {
      setStatusDetail(`Profit ${opp.netProfitAda.toFixed(2)} ₳ below minimum ${minProfitRequired.toFixed(2)} ₳`)
      return
    }

    // Max trade size: 50 ADA default, configurable
    const tradeAmount = settings.tradeSize

    const trade: TradeExecution = {
      id: generateTradeId(),
      timestamp: Date.now(),
      pair: opp.pair,
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      amount: tradeAmount,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      fees: 0,
      netProfit: 0,
      status: settings.dryRun ? 'dry-run' : 'pending',
      dryRun: settings.dryRun,
    }

    setActiveTrade(trade)
    setExecutionStatus('building-buy')

    if (settings.dryRun) {
      // Simulate
      setStatusDetail('Simulating trade (dry run)...')
      await new Promise(r => setTimeout(r, 1500))
      trade.fees = tradeAmount * 0.006 + 0.4
      trade.netProfit = opp.netProfitAda
      trade.status = 'dry-run'

      const updated = addTrade(trade)
      setRecentTrades(updated.slice(0, 50))
      notifyTrade(trade)
      notifyDiscord(trade)
    } else if (serverWallet?.configured) {
      // SERVER-SIDE EXECUTION (auto-sign with hot wallet)
      try {
        const result = await executeServerSide({
          pair: opp.pair,
          buyDex: opp.buyDex,
          sellDex: opp.sellDex,
          amountAda: tradeAmount,
          slippagePct: settings.maxSlippage,
          onStatus: (status, detail) => {
            setExecutionStatus(status as ExecutionStatus)
            if (detail) setStatusDetail(detail)
          },
        })

        trade.buyTxHash = result.buyTxHash
        trade.sellTxHash = result.sellTxHash
        trade.fees = result.totalFees
        trade.status = result.success ? 'completed' : 'failed'
        trade.errorMessage = result.error
        trade.netProfit = result.success ? (opp.netProfitAda - result.totalFees) : 0

        const updated = addTrade(trade)
        setRecentTrades(updated.slice(0, 50))
        notifyTrade(trade)
        notifyDiscord(trade)
        refreshServerWallet()
      } catch (e) {
        trade.status = 'failed'
        trade.errorMessage = e instanceof Error ? e.message : 'Unknown error'
        addTrade(trade)
        notifyTrade(trade)
      }
    } else if (wallet.connected && wallet.api) {
      // BROWSER WALLET EXECUTION (CIP-30 fallback)
      try {
        const result = await executeArbitrage(wallet.api, wallet.address, {
          pair: opp.pair,
          buyDex: opp.buyDex,
          sellDex: opp.sellDex,
          amountAda: tradeAmount,
          slippagePct: settings.maxSlippage,
          onStatus: (status, detail) => {
            setExecutionStatus(status as ExecutionStatus)
            if (detail) setStatusDetail(detail)
          },
        })

        trade.buyTxHash = result.buyTxHash
        trade.sellTxHash = result.sellTxHash
        trade.fees = result.totalFees
        trade.status = result.success ? 'completed' : 'failed'
        trade.errorMessage = result.error
        trade.netProfit = result.success ? (opp.netProfitAda - result.totalFees) : 0

        const updated = addTrade(trade)
        setRecentTrades(updated.slice(0, 50))
        notifyTrade(trade)
        notifyDiscord(trade)
        wallet.refreshBalance()
      } catch (e) {
        trade.status = 'failed'
        trade.errorMessage = e instanceof Error ? e.message : 'Unknown error'
        addTrade(trade)
        notifyTrade(trade)
      }
    } else {
      trade.status = 'failed'
      trade.errorMessage = 'No wallet available (server wallet not configured, browser wallet not connected)'
      addTrade(trade)
    }

    setActiveTrade(null)
    setExecutionStatus('idle')
    setDailyPnL(getDailyPnL())
    setLastTradeTime(Date.now())
  }, [executionStatus, settings, wallet, lastTradeTime, serverWallet, refreshServerWallet])

  return (
    <ExecutionContext.Provider value={{
      settings,
      updateSettings,
      activeTrade,
      executionStatus,
      statusDetail,
      recentTrades,
      dailyPnL,
      isAutoTrading: settings.autoTrade,
      lastTradeTime,
      serverWallet,
      executeTrade,
      killSwitch,
      toggleAutoTrade,
      refreshPnL,
      refreshServerWallet,
    }}>
      {children}
    </ExecutionContext.Provider>
  )
}
