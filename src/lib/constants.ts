export const DEX_FEES: Record<string, number> = {
  Minswap: 0.003,
  SundaeSwap: 0.003,
  WingRiders: 0.0035,
  MuesliSwap: 0.003,
}

// Real per-swap cost: ~0.3 ADA network fee + ~2 ADA batcher fee + ~1.5 ADA DexHunter fee = ~3.8 ADA
export const TX_FEE_ADA = 3.8

export const DEFAULT_TRADE_SIZE_ADA = 1000

export const TOKEN_POLICY_IDS: Record<string, { policyId: string; assetName: string }> = {
  MIN: { policyId: '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6', assetName: '4d494e' },
  SUNDAE: { policyId: '9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d77', assetName: '53554e444145' },
  HOSKY: { policyId: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235', assetName: '484f534b59' },
  WRT: { policyId: 'c0ee29a85b13209423b10447d3c2e6a50641a15c57770e27cb9d5073', assetName: '57696e67526964657273' },
  MILK: { policyId: '8a1cfae21368b8bebbbed9800fec304e95cce39a2a57dc35e2e3ebaa', assetName: '4d494c4b' },
  SNEK: { policyId: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f', assetName: '534e454b' },
  INDY: { policyId: '533bb94a8850ee3ccbe483106489399112b74c905342cb1571b714e2', assetName: '494e4459' },
  LENFI: { policyId: '8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f69587', assetName: '4c454e4649' },
  DJED: { policyId: '8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61', assetName: '446a65644d6963726f555344' },
  iUSD: { policyId: 'f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880', assetName: '69555344' },
  AGIX: { policyId: 'f43a62fdc3965df486de8a0d32fe800963589c41b38946602a8dc8e0', assetName: '41474958' },
  WMT: { policyId: '1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e', assetName: '776f726c646d6f62696c65746f6b656e' },
  NMKR: { policyId: '5dac8536653edc12f6f5e1045d8164b9f59998d3bdc300fc928434894e4d4b52', assetName: '4e4d4b52' },
  JPG: { policyId: 'da8c30857834c6ae7203935b89278c532b3995245295456f993e1d24', assetName: '4a5047' },
  GENS: { policyId: 'dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb', assetName: '47454e53' },
}

export const TOKENS = [
  { symbol: 'ADA', name: 'Cardano', decimals: 6 },
  { symbol: 'HOSKY', name: 'Hosky Token', decimals: 0 },
  { symbol: 'MIN', name: 'Minswap', decimals: 6 },
  { symbol: 'SUNDAE', name: 'SundaeSwap', decimals: 6 },
  { symbol: 'WRT', name: 'WingRiders', decimals: 6 },
  { symbol: 'SNEK', name: 'Snek', decimals: 0 },
  { symbol: 'INDY', name: 'Indigo', decimals: 6 },
  { symbol: 'LENFI', name: 'Lenfi', decimals: 6 },
  { symbol: 'DJED', name: 'Djed', decimals: 6 },
  { symbol: 'iUSD', name: 'iUSD', decimals: 6 },
  { symbol: 'MILK', name: 'MuesliSwap Milk', decimals: 6 },
  { symbol: 'AGIX', name: 'SingularityNET', decimals: 6 },
  { symbol: 'WMT', name: 'World Mobile', decimals: 6 },
  { symbol: 'NMKR', name: 'NMKR', decimals: 6 },
  { symbol: 'JPG', name: 'JPG Store', decimals: 6 },
  { symbol: 'GENS', name: 'Genius Yield', decimals: 6 },
]

export const DEXES = ['Minswap', 'SundaeSwap', 'WingRiders', 'MuesliSwap'] as const
export type DexName = (typeof DEXES)[number]

export const DEX_SWAP_URLS: Record<string, string> = {
  Minswap: 'https://app.minswap.org/swap',
  SundaeSwap: 'https://app.sundae.fi/swap',
  WingRiders: 'https://app.wingriders.com/swap',
  MuesliSwap: 'https://muesliswap.com/swap',
}

export const REFRESH_INTERVAL_MS = 15_000
export const CACHE_TTL_MS = 12_000
export const STALE_THRESHOLD_MS = 30_000

export const RISK_LEVELS = {
  conservative: { label: 'Conservative', minSpread: 5, description: '>5% spread only (safest)' },
  moderate: { label: 'Moderate', minSpread: 3, description: '>3% spread' },
  aggressive: { label: 'Aggressive', minSpread: 2, description: '>2% spread (min to cover fees)' },
} as const
