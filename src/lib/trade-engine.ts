// Auto-Trade Engine Types & Logic

export interface TradeSettings {
  tradeSize: number       // 10-200 ADA, default 200
  minSpread: number       // 1-10%, default 2
  maxSlippage: number     // 0.5-5%, default 1.5
  riskLevel: 'conservative' | 'moderate' | 'aggressive'
  dailyLossLimit: number  // default 50 ADA
  dryRun: boolean         // default true
  autoTrade: boolean      // default false
  cooldownSeconds: number // 30-300, default 60
}

export const DEFAULT_TRADE_SETTINGS: TradeSettings = {
  tradeSize: 200,
  minSpread: 2,
  maxSlippage: 1.5,
  riskLevel: 'moderate',
  dailyLossLimit: 50,
  dryRun: true,
  autoTrade: false,
  cooldownSeconds: 60,
}

export interface TradeExecution {
  id: string
  timestamp: number
  pair: string
  buyDex: string
  sellDex: string
  amount: number
  buyPrice: number
  sellPrice: number
  fees: number
  netProfit: number
  status: 'pending' | 'buying' | 'bought' | 'selling' | 'completed' | 'failed' | 'dry-run'
  buyTxHash?: string
  sellTxHash?: string
  errorMessage?: string
  dryRun: boolean
}

const TRADE_HISTORY_KEY = 'cardano-arb-trades'
const SETTINGS_KEY = 'cardano-arb-trade-settings'
const MIN_BALANCE_RESERVE = 10 // Always keep 10 ADA for fees

export function loadSettings(): TradeSettings {
  if (typeof window === 'undefined') return DEFAULT_TRADE_SETTINGS
  try {
    const s = localStorage.getItem(SETTINGS_KEY)
    return s ? { ...DEFAULT_TRADE_SETTINGS, ...JSON.parse(s) } : DEFAULT_TRADE_SETTINGS
  } catch {
    return DEFAULT_TRADE_SETTINGS
  }
}

export function saveSettings(settings: TradeSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch {}
}

export function loadTradeHistory(): TradeExecution[] {
  if (typeof window === 'undefined') return []
  try {
    const s = localStorage.getItem(TRADE_HISTORY_KEY)
    return s ? JSON.parse(s) : []
  } catch {
    return []
  }
}

export function saveTradeHistory(trades: TradeExecution[]) {
  try { localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(trades)) } catch {}
}

export function addTrade(trade: TradeExecution): TradeExecution[] {
  const history = loadTradeHistory()
  history.unshift(trade)
  // Keep last 500 trades
  const trimmed = history.slice(0, 500)
  saveTradeHistory(trimmed)
  return trimmed
}

export function updateTrade(id: string, update: Partial<TradeExecution>): TradeExecution[] {
  const history = loadTradeHistory()
  const idx = history.findIndex(t => t.id === id)
  if (idx >= 0) {
    history[idx] = { ...history[idx], ...update }
    saveTradeHistory(history)
  }
  return history
}

export function getDailyPnL(): { profit: number; loss: number; net: number; tradeCount: number } {
  const trades = loadTradeHistory()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const ts = dayStart.getTime()

  const today = trades.filter(t => t.timestamp >= ts && (t.status === 'completed' || t.status === 'dry-run'))
  const profit = today.filter(t => t.netProfit > 0).reduce((s, t) => s + t.netProfit, 0)
  const loss = today.filter(t => t.netProfit < 0).reduce((s, t) => s + Math.abs(t.netProfit), 0)
  return { profit, loss, net: profit - loss, tradeCount: today.length }
}

export function canTrade(settings: TradeSettings, balance: number): { ok: boolean; reason?: string } {
  const pnl = getDailyPnL()

  if (pnl.loss >= settings.dailyLossLimit) {
    return { ok: false, reason: `Daily loss limit reached (${pnl.loss.toFixed(2)} ₳ lost today)` }
  }
  if (balance < settings.tradeSize + MIN_BALANCE_RESERVE) {
    return { ok: false, reason: `Insufficient balance (need ${settings.tradeSize + MIN_BALANCE_RESERVE} ₳, have ${balance.toFixed(2)} ₳)` }
  }
  if (settings.tradeSize > 200) {
    return { ok: false, reason: 'Trade size exceeds max (200 ADA)' }
  }
  return { ok: true }
}

export function generateTradeId(): string {
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Notification helpers
export function notifyTrade(trade: TradeExecution) {
  if (typeof window === 'undefined') return

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    const profitable = trade.netProfit > 0
    new Notification(
      profitable ? '✅ Profitable Trade!' : '❌ Trade Loss',
      {
        body: `${trade.pair}: ${trade.netProfit > 0 ? '+' : ''}${trade.netProfit.toFixed(2)} ₳ (${trade.dryRun ? 'DRY RUN' : 'LIVE'})`,
        icon: profitable ? '💰' : '📉',
      }
    )
  }

  // Play sound
  try {
    const profitable = trade.netProfit > 0
    const freq = profitable ? 800 : 300
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    osc.type = profitable ? 'sine' : 'sawtooth'
    gain.gain.value = 0.1
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.stop(ctx.currentTime + 0.5)
  } catch {}
}

// Discord webhook notification
export async function notifyDiscord(trade: TradeExecution) {
  try {
    const r = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notify', trade }),
    })
    return r.ok
  } catch {
    return false
  }
}
