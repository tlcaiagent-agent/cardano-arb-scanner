'use client'

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'
import { useWallet } from './wallet-context'
import { ArbOpportunity } from './types'
import {
  TradeSettings, TradeExecution, DEFAULT_TRADE_SETTINGS,
  loadSettings, saveSettings, loadTradeHistory, addTrade, updateTrade,
  getDailyPnL, canTrade, generateTradeId, notifyTrade, notifyDiscord,
} from './trade-engine'
import { executeArbitrage } from './swap-executor'

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
  // Actions
  executeTrade: (opp: ArbOpportunity) => Promise<void>
  killSwitch: () => void
  toggleAutoTrade: () => void
  refreshPnL: () => void
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
  const killRef = useRef(false)

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

    // Safety checks
    const check = canTrade(settings, wallet.balance)
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
    const estimatedFees = 0.5 // ~0.25 ADA per tx * 2
    const minProfitRequired = estimatedFees + (settings.tradeSize * 0.01) // fees + 1% of trade size
    if (opp.netProfitAda < minProfitRequired) {
      setStatusDetail(`Profit ${opp.netProfitAda.toFixed(2)} ₳ below minimum ${minProfitRequired.toFixed(2)} ₳`)
      return
    }

    // Max trade size: 50 ADA default, configurable
    const tradeAmount = Math.min(settings.tradeSize, 200) // Hard cap at 200

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
    } else if (wallet.connected && wallet.api) {
      // REAL EXECUTION
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
      trade.errorMessage = 'Wallet not connected'
      addTrade(trade)
    }

    setActiveTrade(null)
    setExecutionStatus('idle')
    setDailyPnL(getDailyPnL())
    setLastTradeTime(Date.now())
  }, [executionStatus, settings, wallet, lastTradeTime])

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
      executeTrade,
      killSwitch,
      toggleAutoTrade,
      refreshPnL,
    }}>
      {children}
    </ExecutionContext.Provider>
  )
}
