'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { WalletAPI, DetectedWallet, detectWallets, connectWallet, getBalanceAda, truncateAddress } from './wallet'

interface WalletState {
  connected: boolean
  connecting: boolean
  walletName: string | null
  walletId: string | null
  api: WalletAPI | null
  address: string
  addressTruncated: string
  balance: number
  detectedWallets: DetectedWallet[]
  error: string | null
  connect: (walletId: string) => Promise<void>
  disconnect: () => void
  refreshBalance: () => Promise<void>
  refreshWallets: () => void
}

const WalletContext = createContext<WalletState>({
  connected: false,
  connecting: false,
  walletName: null,
  walletId: null,
  api: null,
  address: '',
  addressTruncated: '',
  balance: 0,
  detectedWallets: [],
  error: null,
  connect: async () => {},
  disconnect: () => {},
  refreshBalance: async () => {},
  refreshWallets: () => {},
})

export function useWallet() {
  return useContext(WalletContext)
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [walletName, setWalletName] = useState<string | null>(null)
  const [walletId, setWalletId] = useState<string | null>(null)
  const [api, setApi] = useState<WalletAPI | null>(null)
  const [address, setAddress] = useState('')
  const [balance, setBalance] = useState(0)
  const [detectedWallets, setDetectedWallets] = useState<DetectedWallet[]>([])
  const [error, setError] = useState<string | null>(null)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const refreshWallets = useCallback(() => {
    setDetectedWallets(detectWallets())
  }, [])

  // Detect wallets on mount + after short delay (some wallets inject late)
  useEffect(() => {
    refreshWallets()
    const t = setTimeout(refreshWallets, 1000)
    return () => clearTimeout(t)
  }, [refreshWallets])

  const refreshBalance = useCallback(async () => {
    if (!api) return
    try {
      const bal = await getBalanceAda(api)
      setBalance(bal)
    } catch {}
  }, [api])

  // Auto-refresh balance every 30s
  useEffect(() => {
    if (connected && api) {
      refreshBalance()
      refreshIntervalRef.current = setInterval(refreshBalance, 30000)
      return () => {
        if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
      }
    }
  }, [connected, api, refreshBalance])

  const connect = useCallback(async (id: string) => {
    setConnecting(true)
    setError(null)
    try {
      const result = await connectWallet(id)
      setApi(result.api)
      setAddress(result.address)
      setBalance(result.balance)
      setWalletId(id)
      const detected = detectWallets()
      const w = detected.find(d => d.id === id)
      setWalletName(w?.name || id)
      setConnected(true)
      // Persist preference
      try { localStorage.setItem('cardano-arb-wallet', id) } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
      setConnected(false)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setConnected(false)
    setApi(null)
    setAddress('')
    setBalance(0)
    setWalletId(null)
    setWalletName(null)
    setError(null)
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
    try { localStorage.removeItem('cardano-arb-wallet') } catch {}
  }, [])

  // Auto-reconnect on page load
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('cardano-arb-wallet') : null
    if (saved) {
      // Delay to let wallet extensions inject
      const t = setTimeout(() => {
        const wallets = detectWallets()
        if (wallets.find(w => w.id === saved)) {
          connect(saved).catch(() => {})
        }
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [connect])

  return (
    <WalletContext.Provider value={{
      connected,
      connecting,
      walletName,
      walletId,
      api,
      address,
      addressTruncated: truncateAddress(address),
      balance,
      detectedWallets,
      error,
      connect,
      disconnect,
      refreshBalance,
      refreshWallets,
    }}>
      {children}
    </WalletContext.Provider>
  )
}
