import { TokenPrice, DexStatus } from './types'
import { STALE_THRESHOLD_MS } from './constants'
import { TOKEN_POLICY_IDS } from './constants'

interface FetchResult {
  prices: TokenPrice[]
  status: DexStatus
}

// ─── Per-DEX cache ───
const dexCache = new Map<string, { result: FetchResult; ts: number }>()
const DEX_CACHE_TTL = 12_000 // 12s

function getCached(dex: string): FetchResult | null {
  const c = dexCache.get(dex)
  if (!c) return null
  if (Date.now() - c.ts < DEX_CACHE_TTL) return c.result
  if (Date.now() - c.ts < STALE_THRESHOLD_MS) {
    return { ...c.result, status: { ...c.result.status, status: 'stale' } }
  }
  return null
}

function setCache(dex: string, result: FetchResult) {
  dexCache.set(dex, { result, ts: Date.now() })
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Known token symbols ───
const TRACKED_SYMBOLS = new Set([
  'HOSKY', 'MIN', 'SUNDAE', 'WRT', 'SNEK', 'INDY', 'LENFI',
  'DJED', 'IUSD', 'iUSD', 'MILK', 'AGIX', 'WMT', 'NMKR', 'JPG', 'GENS',
  'OPTIM', 'FACT', 'ENCS', 'COPI', 'IAG', 'NTX', 'AADA',
])

function normalizeSymbol(s: string): string {
  if (!s) return ''
  const up = s.toUpperCase()
  if (up === 'IUSD') return 'iUSD'
  return up
}

// ─── DexHunter v3 API - Primary price source ───
// Uses /swap/estimate to get prices across ALL DEXes in one call
const DEXHUNTER_API = 'https://api-us.dexhunterv3.app'
const DEXHUNTER_PARTNER_KEY = process.env.DEXHUNTER_API_KEY || ''

// Map DEX names from DexHunter splits to our display names
const DEX_NAME_MAP: Record<string, string> = {
  'MINSWAP': 'Minswap',
  'MINSWAPV2': 'Minswap',
  'MS2HOP': 'Minswap',
  'SUNDAESWAP': 'SundaeSwap',
  'SUNDAESWAPV3': 'SundaeSwap',
  'WINGRIDER': 'WingRiders',
  'WINGRIDERS': 'WingRiders',
  'WINGRIDERV2': 'WingRiders',
  'MUESLISWAP': 'MuesliSwap',
  'VYFI': 'VyFi',
  'SPECTRUM': 'Spectrum',
  'SPLASH': 'Splash',
  'CSWAP': 'CSWAP',
  'CHADSWAP': 'ChadSwap',
}

function mapDexName(raw: string): string {
  return DEX_NAME_MAP[raw] || raw
}

// Tokens to query via DexHunter estimate (their unit = policyId+hex)
const ESTIMATE_TOKENS: { symbol: string; unit: string }[] = Object.entries(TOKEN_POLICY_IDS).map(
  ([symbol, { policyId, assetName }]) => ({ symbol, unit: policyId + assetName })
)

// DEX groups for blacklist-based per-DEX querying
const DEX_GROUPS: { name: string; blacklistOthers: string[] }[] = [
  { name: 'Minswap', blacklistOthers: ['SUNDAESWAP', 'SUNDAESWAPV3', 'WINGRIDER', 'WINGRIDERV2', 'MUESLISWAP', 'VYFI', 'SPLASH', 'CSWAP', 'CHADSWAP', 'SNEKFUN', 'CHAKRA', 'SHADOWBOOK'] },
  { name: 'SundaeSwap', blacklistOthers: ['MINSWAP', 'MINSWAPV2', 'MS2HOP', 'WINGRIDER', 'WINGRIDERV2', 'MUESLISWAP', 'VYFI', 'SPLASH', 'CSWAP', 'CHADSWAP', 'SNEKFUN', 'CHAKRA', 'SHADOWBOOK'] },
  { name: 'WingRiders', blacklistOthers: ['MINSWAP', 'MINSWAPV2', 'MS2HOP', 'SUNDAESWAP', 'SUNDAESWAPV3', 'MUESLISWAP', 'VYFI', 'SPLASH', 'CSWAP', 'CHADSWAP', 'SNEKFUN', 'CHAKRA', 'SHADOWBOOK'] },
  { name: 'VyFi', blacklistOthers: ['MINSWAP', 'MINSWAPV2', 'MS2HOP', 'SUNDAESWAP', 'SUNDAESWAPV3', 'WINGRIDER', 'WINGRIDERV2', 'MUESLISWAP', 'SPLASH', 'CSWAP', 'CHADSWAP', 'SNEKFUN', 'CHAKRA', 'SHADOWBOOK'] },
  { name: 'Splash', blacklistOthers: ['MINSWAP', 'MINSWAPV2', 'MS2HOP', 'SUNDAESWAP', 'SUNDAESWAPV3', 'WINGRIDER', 'WINGRIDERV2', 'MUESLISWAP', 'VYFI', 'CSWAP', 'CHADSWAP', 'SNEKFUN', 'CHAKRA', 'SHADOWBOOK'] },
  { name: 'MuesliSwap', blacklistOthers: ['MINSWAP', 'MINSWAPV2', 'MS2HOP', 'SUNDAESWAP', 'SUNDAESWAPV3', 'WINGRIDER', 'WINGRIDERV2', 'VYFI', 'SPLASH', 'CSWAP', 'CHADSWAP', 'SNEKFUN', 'CHAKRA', 'SHADOWBOOK'] },
]

async function fetchPerDexPrice(tokenSymbol: string, tokenUnit: string, dexGroup: typeof DEX_GROUPS[0], amountAda: number = 100): Promise<TokenPrice | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (DEXHUNTER_PARTNER_KEY) headers['X-Partner-Id'] = DEXHUNTER_PARTNER_KEY

  const body = {
    token_in: '',
    token_out: tokenUnit,
    amount_in: amountAda,
    slippage: 2,
    blacklisted_dexes: dexGroup.blacklistOthers,
  }

  try {
    const resp = await fetchWithTimeout(`${DEXHUNTER_API}/swap/estimate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, 6000)

    if (!resp.ok) return null
    const data = await resp.json()
    const output = data.total_output
    if (!output || output <= 0) return null

    return {
      tokenA: 'ADA',
      tokenB: tokenSymbol,
      pair: `ADA/${tokenSymbol}`,
      dex: dexGroup.name,
      price: amountAda / output,
      liquidity: output,
      timestamp: Date.now(),
    }
  } catch {
    return null
  }
}

async function fetchDexHunterEstimate(tokenSymbol: string, tokenUnit: string, amountAda: number = 100): Promise<TokenPrice[]> {
  // Query each DEX individually by blacklisting all others
  const results = await Promise.all(
    DEX_GROUPS.map(dg => fetchPerDexPrice(tokenSymbol, tokenUnit, dg, amountAda))
  )
  return results.filter((p): p is TokenPrice => p !== null)
}

/**
 * Fetch prices for all tracked tokens via DexHunter estimate endpoint.
 * This gives us per-DEX pricing across all Cardano DEXes in a reliable way.
 */
async function fetchAllViaDexHunter(): Promise<FetchResult> {
  const cached = getCached('DexHunterAll')
  if (cached) return cached
  const start = Date.now()

  try {
    // Fetch estimates for all tracked tokens in parallel (with concurrency limit)
    const allPrices: TokenPrice[] = []
    const batchSize = 4
    for (let i = 0; i < ESTIMATE_TOKENS.length; i += batchSize) {
      const batch = ESTIMATE_TOKENS.slice(i, i + batchSize)
      const results = await Promise.allSettled(
        batch.map(t => fetchDexHunterEstimate(t.symbol, t.unit))
      )
      for (const r of results) {
        if (r.status === 'fulfilled') allPrices.push(...r.value)
      }
    }

    if (allPrices.length === 0) throw new Error('No prices from DexHunter estimates')

    const result: FetchResult = {
      prices: allPrices,
      status: {
        name: 'DexHunter',
        status: 'live',
        lastUpdate: Date.now(),
        pairCount: allPrices.length,
        responseTimeMs: Date.now() - start,
      },
    }
    setCache('DexHunterAll', result)
    return result
  } catch (e) {
    console.error('[DexHunter] fetch failed:', e instanceof Error ? e.message : e)
    return {
      prices: demoDataForAllDexes(),
      status: {
        name: 'DexHunter',
        status: 'demo',
        lastUpdate: Date.now(),
        pairCount: 0,
        responseTimeMs: Date.now() - start,
      },
    }
  }
}

// ─── MuesliSwap direct (fallback) ───
async function fetchMuesliSwap(): Promise<FetchResult> {
  const dex = 'MuesliSwap'
  const cached = getCached(dex)
  if (cached) return cached
  const start = Date.now()
  try {
    const resp = await fetchWithTimeout('https://api.muesliswap.com/price', {
      headers: { 'Accept': 'application/json' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const prices: TokenPrice[] = []
    if (Array.isArray(data)) {
      for (const item of data) {
        const symbol = item.info?.symbol || item.symbol || ''
        const normalized = normalizeSymbol(symbol)
        if (!normalized) continue
        const price = parseFloat(item.price?.value || item.price || '0')
        if (!price || !isFinite(price)) continue
        prices.push({
          tokenA: 'ADA', tokenB: normalized,
          pair: `ADA/${normalized}`, dex,
          price, liquidity: parseFloat(item.liquidity || item.supply?.circulatingOnDex || '10000'),
          timestamp: Date.now(),
        })
      }
    }
    if (prices.length === 0) throw new Error('No prices parsed')
    const result: FetchResult = {
      prices,
      status: { name: dex, status: 'live', lastUpdate: Date.now(), pairCount: prices.length, responseTimeMs: Date.now() - start }
    }
    setCache(dex, result)
    return result
  } catch (e) {
    console.error(`[${dex}] fetch failed:`, e instanceof Error ? e.message : e)
    return { prices: [], status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0, responseTimeMs: Date.now() - start } }
  }
}

// ─── Demo data generator ───
function demoDataForDex(dex: string): TokenPrice[] {
  const basePrices: Record<string, number> = {
    MIN: 0.042, SUNDAE: 0.0058, HOSKY: 0.000000058,
    WRT: 0.085, MILK: 0.32, SNEK: 0.0032,
    INDY: 1.85, LENFI: 0.78, OPTIM: 0.12,
    iUSD: 1.0, DJED: 1.0, AGIX: 0.28,
    WMT: 0.15, NMKR: 0.008, JPG: 0.0045, GENS: 0.023,
  }
  const dexOffsets: Record<string, number> = {
    Minswap: 0, SundaeSwap: 0.008, WingRiders: -0.005, MuesliSwap: 0.012,
  }
  const offset = dexOffsets[dex] || 0
  const jitter = () => (Math.random() - 0.5) * 0.015

  return Object.entries(basePrices).map(([symbol, base]) => ({
    tokenA: 'ADA', tokenB: symbol, pair: `ADA/${symbol}`, dex,
    price: base * (1 + offset + jitter()),
    liquidity: 5000 + Math.random() * 95000,
    timestamp: Date.now(),
  }))
}

function demoDataForAllDexes(): TokenPrice[] {
  return [
    ...demoDataForDex('Minswap'),
    ...demoDataForDex('SundaeSwap'),
    ...demoDataForDex('WingRiders'),
    ...demoDataForDex('MuesliSwap'),
  ]
}

// ─── Main fetch-all ───
export async function fetchAllPrices(): Promise<{ prices: TokenPrice[]; statuses: DexStatus[] }> {
  // Primary: use DexHunter estimate which gives us per-DEX pricing
  // Fallback: MuesliSwap direct API
  const results = await Promise.allSettled([
    fetchAllViaDexHunter(),
    fetchMuesliSwap(),
  ])

  const prices: TokenPrice[] = []
  const statuses: DexStatus[] = []

  for (const r of results) {
    if (r.status === 'fulfilled') {
      prices.push(...r.value.prices)
      statuses.push(r.value.status)
    }
  }

  // Deduplicate: if DexHunter gave us prices for a dex+pair, skip MuesliSwap's version
  const seen = new Set<string>()
  const deduped: TokenPrice[] = []
  for (const p of prices) {
    const key = `${p.dex}:${p.pair}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(p)
    }
  }

  return { prices: deduped, statuses }
}
