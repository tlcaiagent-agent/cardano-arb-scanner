// CIP-30 Wallet Connection Utilities

export interface CardanoWallet {
  enable(): Promise<WalletAPI>
  isEnabled(): Promise<boolean>
  apiVersion: string
  name: string
  icon: string
}

export interface WalletAPI {
  getNetworkId(): Promise<number>
  getUtxos(): Promise<string[] | null>
  getBalance(): Promise<string>
  getUsedAddresses(): Promise<string[]>
  getChangeAddress(): Promise<string>
  signTx(tx: string, partialSign?: boolean): Promise<string>
  submitTx(tx: string): Promise<string>
}

export interface DetectedWallet {
  id: string
  name: string
  icon: string
  apiVersion: string
  wallet: CardanoWallet
}

const KNOWN_WALLETS = ['eternl', 'nami', 'lace', 'flint', 'vespr', 'typhon', 'gerowallet', 'begin'] as const

export function detectWallets(): DetectedWallet[] {
  if (typeof window === 'undefined' || !window.cardano) return []
  const detected: DetectedWallet[] = []
  for (const id of KNOWN_WALLETS) {
    const w = (window.cardano as Record<string, CardanoWallet | undefined>)[id]
    if (w && typeof w.enable === 'function') {
      detected.push({
        id,
        name: w.name || id,
        icon: w.icon || '',
        apiVersion: w.apiVersion || '0',
        wallet: w,
      })
    }
  }
  return detected
}

export async function connectWallet(walletId: string): Promise<{ api: WalletAPI; address: string; balance: number }> {
  if (typeof window === 'undefined' || !window.cardano) {
    throw new Error('Cardano wallet API not available')
  }
  const w = (window.cardano as Record<string, CardanoWallet | undefined>)[walletId]
  if (!w) throw new Error(`Wallet "${walletId}" not found`)

  const api = await w.enable()
  const networkId = await api.getNetworkId()
  if (networkId !== 1) {
    throw new Error('Please switch to Cardano Mainnet (network ID 1)')
  }

  const addresses = await api.getUsedAddresses()
  const address = addresses[0] || await api.getChangeAddress()
  const balance = await getBalanceAda(api)

  return { api, address, balance }
}

export async function getBalanceAda(api: WalletAPI): Promise<number> {
  try {
    const balanceHex = await api.getBalance()
    // CIP-30 returns CBOR-encoded value. For simple ADA balance, parse the lovelace.
    // The balance is a CBOR encoded Coin or Value.
    // Simple approach: if it's just a number (pure ADA), decode it directly.
    const lovelace = parseCborBalance(balanceHex)
    return lovelace / 1_000_000
  } catch {
    return 0
  }
}

function parseCborBalance(hex: string): number {
  // CBOR decoding for balance - handles both simple integer and [coin, multiasset] formats
  const bytes = hexToBytes(hex)
  if (bytes.length === 0) return 0
  
  const firstByte = bytes[0]
  const majorType = firstByte >> 5
  
  if (majorType === 0) {
    // Unsigned integer
    return decodeCborUint(bytes)
  } else if (majorType === 4) {
    // Array - first element is lovelace
    // Skip array header, decode first element
    let offset = 1
    if ((firstByte & 0x1f) === 25) offset = 3
    else if ((firstByte & 0x1f) === 26) offset = 5
    return decodeCborUint(bytes.slice(offset))
  } else if (majorType === 5) {
    // Map - try parsing as Value type
    // Fallback: try to find the lovelace amount
    return decodeCborUint(bytes.slice(1))
  }
  
  // Fallback: try raw integer parse
  return decodeCborUint(bytes)
}

function decodeCborUint(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  const additional = bytes[0] & 0x1f
  if (additional < 24) return additional
  if (additional === 24 && bytes.length >= 2) return bytes[1]
  if (additional === 25 && bytes.length >= 3) return (bytes[1] << 8) | bytes[2]
  if (additional === 26 && bytes.length >= 5) {
    return ((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0
  }
  if (additional === 27 && bytes.length >= 9) {
    // 8-byte integer - use Number (safe for ADA amounts up to ~9 quadrillion lovelace)
    let val = 0
    for (let i = 1; i <= 8; i++) {
      val = val * 256 + bytes[i]
    }
    return val
  }
  return 0
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16)
  }
  return bytes
}

export function truncateAddress(addr: string): string {
  if (!addr || addr.length < 20) return addr
  return addr.slice(0, 12) + '...' + addr.slice(-8)
}

// Extend window type for CIP-30
declare global {
  interface Window {
    cardano?: Record<string, CardanoWallet | undefined>
  }
}
