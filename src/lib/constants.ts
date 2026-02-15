export const DEX_FEES: Record<string, number> = {
  Minswap: 0.003,      // 0.3%
  SundaeSwap: 0.003,
  WingRiders: 0.0035,
  MuesliSwap: 0.003,
}

export const TX_FEE_ADA = 0.25  // average Cardano tx fee

export const DEFAULT_TRADE_SIZE_ADA = 1000

export const TOKENS = [
  { symbol: 'ADA', name: 'Cardano', decimals: 6 },
  { symbol: 'MIN', name: 'Minswap', decimals: 6 },
  { symbol: 'SUNDAE', name: 'SundaeSwap', decimals: 6 },
  { symbol: 'HOSKY', name: 'Hosky Token', decimals: 0 },
  { symbol: 'WRT', name: 'WingRiders', decimals: 6 },
  { symbol: 'MILK', name: 'MuesliSwap', decimals: 6 },
  { symbol: 'SNEK', name: 'Snek', decimals: 0 },
  { symbol: 'INDY', name: 'Indigo', decimals: 6 },
  { symbol: 'LENFI', name: 'Lenfi', decimals: 6 },
  { symbol: 'OPTIM', name: 'Optim', decimals: 6 },
  { symbol: 'iUSD', name: 'iUSD', decimals: 6 },
  { symbol: 'DJED', name: 'Djed', decimals: 6 },
]

export const DEXES = ['Minswap', 'SundaeSwap', 'WingRiders', 'MuesliSwap'] as const
export type DexName = typeof DEXES[number]

export const REFRESH_INTERVAL_MS = 15_000
export const CACHE_TTL_MS = 12_000
