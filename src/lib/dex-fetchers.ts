import { TokenPrice, DexStatus } from './types'
import { STALE_THRESHOLD_MS } from './constants'

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
  // Mark stale but still return
  if (Date.now() - c.ts < STALE_THRESHOLD_MS) {
    return {
      ...c.result,
      status: { ...c.result.status, status: 'stale' }
    }
  }
  return null
}

function setCache(dex: string, result: FetchResult) {
  dexCache.set(dex, { result, ts: Date.now() })
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 5000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Known token symbols by partial matching ───
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

function isTracked(symbol: string): boolean {
  if (!symbol) return false
  return TRACKED_SYMBOLS.has(symbol.toUpperCase()) || TRACKED_SYMBOLS.has(symbol)
}

// ─── MuesliSwap ───
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
    return { prices: demoDataForDex(dex), status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0, responseTimeMs: Date.now() - start } }
  }
}

// ─── DexHunter ───
async function fetchDexHunter(): Promise<FetchResult> {
  const dex = 'DexHunter'
  const cached = getCached(dex)
  if (cached) return cached
  const start = Date.now()
  try {
    const resp = await fetchWithTimeout('https://api-us.dexhunter.io/community/pairs', {
      headers: { 'Accept': 'application/json' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const prices: TokenPrice[] = []
    const pairs = Array.isArray(data) ? data : data?.pairs || data?.data || []
    for (const item of pairs) {
      const symbol = normalizeSymbol(item.token_b?.symbol || item.tokenB?.symbol || item.symbol || '')
      if (!symbol) continue
      const price = parseFloat(item.price || item.last_price || '0')
      if (!price || !isFinite(price)) continue
      prices.push({
        tokenA: 'ADA', tokenB: symbol,
        pair: `ADA/${symbol}`, dex,
        price, liquidity: parseFloat(item.tvl || item.liquidity || '5000'),
        timestamp: Date.now(),
      })
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
    // DexHunter doesn't get demo fallback — it's supplementary
    return { prices: [], status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0, responseTimeMs: Date.now() - start } }
  }
}

// ─── Minswap ───
async function fetchMinswap(): Promise<FetchResult> {
  const dex = 'Minswap'
  const cached = getCached(dex)
  if (cached) return cached
  const start = Date.now()
  try {
    const resp = await fetchWithTimeout('https://api-mainnet-prod.minswap.org/commerce/pools?page=1&limit=30', {
      headers: { 'Accept': 'application/json' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const prices: TokenPrice[] = []
    const pools = Array.isArray(data) ? data : data?.data || data?.pools || []
    for (const pool of pools) {
      const symbol = normalizeSymbol(pool?.tokenB?.symbol || pool?.pair?.split('/')[1] || '')
      const price = parseFloat(pool?.price || pool?.tokenBPrice || '0')
      if (!symbol || !price || !isFinite(price)) continue
      prices.push({
        tokenA: 'ADA', tokenB: symbol,
        pair: `ADA/${symbol}`, dex,
        price, liquidity: parseFloat(pool?.tvl || pool?.liquidity || '5000'),
        timestamp: Date.now(),
      })
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
    return { prices: demoDataForDex(dex), status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0, responseTimeMs: Date.now() - start } }
  }
}

// ─── SundaeSwap ───
async function fetchSundaeSwap(): Promise<FetchResult> {
  const dex = 'SundaeSwap'
  const cached = getCached(dex)
  if (cached) return cached
  const start = Date.now()
  try {
    const resp = await fetchWithTimeout('https://stats.sundaeswap.finance/api/v1/pools', {
      headers: { 'Accept': 'application/json' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const prices: TokenPrice[] = []
    const pools = Array.isArray(data) ? data : data?.pools || []
    for (const pool of pools.slice(0, 30)) {
      const symbol = normalizeSymbol(pool?.tokenB?.ticker || pool?.pair?.split('/')[1] || '')
      const price = parseFloat(pool?.price || '0')
      if (!symbol || !price || !isFinite(price)) continue
      prices.push({
        tokenA: 'ADA', tokenB: symbol,
        pair: `ADA/${symbol}`, dex,
        price, liquidity: parseFloat(pool?.tvl || '5000'),
        timestamp: Date.now(),
      })
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
    return { prices: demoDataForDex(dex), status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0, responseTimeMs: Date.now() - start } }
  }
}

// ─── WingRiders ───
async function fetchWingRiders(): Promise<FetchResult> {
  const dex = 'WingRiders'
  const cached = getCached(dex)
  if (cached) return cached
  const start = Date.now()
  try {
    const resp = await fetchWithTimeout('https://api.wingriders.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ pools(first: 20) { tokenA { symbol } tokenB { symbol } price tvl } }`
      })
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const json = await resp.json()
    const pools = json?.data?.pools || []
    const prices: TokenPrice[] = []
    for (const pool of pools) {
      const symbol = normalizeSymbol(pool?.tokenB?.symbol || '')
      const price = parseFloat(pool?.price || '0')
      if (!symbol || !price || !isFinite(price)) continue
      prices.push({
        tokenA: 'ADA', tokenB: symbol,
        pair: `ADA/${symbol}`, dex,
        price, liquidity: parseFloat(pool?.tvl || '5000'),
        timestamp: Date.now(),
      })
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
    return { prices: demoDataForDex(dex), status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0, responseTimeMs: Date.now() - start } }
  }
}

// ─── CoinGecko fallback ───
async function fetchCoinGecko(): Promise<FetchResult> {
  const dex = 'CoinGecko'
  const cached = getCached(dex)
  if (cached) return cached
  const start = Date.now()
  try {
    const resp = await fetchWithTimeout('https://api.coingecko.com/api/v3/coins/cardano/tickers?include_exchange_logo=false&depth=true', {
      headers: { 'Accept': 'application/json' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const prices: TokenPrice[] = []
    const tickers = data?.tickers || []
    for (const t of tickers) {
      if (t.base !== 'ADA') continue
      const symbol = normalizeSymbol(t.target || '')
      if (!symbol || symbol === 'USD' || symbol === 'USDT' || symbol === 'BTC' || symbol === 'ETH') continue
      const price = parseFloat(t.last || '0')
      if (!price || !isFinite(price)) continue
      prices.push({
        tokenA: 'ADA', tokenB: symbol,
        pair: `ADA/${symbol}`, dex: t.market?.name || 'CoinGecko',
        price, liquidity: parseFloat(t.volume || '1000'),
        timestamp: Date.now(),
      })
    }
    const result: FetchResult = {
      prices,
      status: { name: dex, status: prices.length > 0 ? 'live' : 'demo', lastUpdate: Date.now(), pairCount: prices.length, responseTimeMs: Date.now() - start }
    }
    if (prices.length > 0) setCache(dex, result)
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
    tokenA: 'ADA',
    tokenB: symbol,
    pair: `ADA/${symbol}`,
    dex,
    price: base * (1 + offset + jitter()),
    liquidity: 5000 + Math.random() * 95000,
    timestamp: Date.now(),
  }))
}

// ─── Main fetch-all ───
export async function fetchAllPrices(): Promise<{ prices: TokenPrice[]; statuses: DexStatus[] }> {
  const results = await Promise.allSettled([
    fetchMuesliSwap(),
    fetchMinswap(),
    fetchSundaeSwap(),
    fetchWingRiders(),
    fetchDexHunter(),
    fetchCoinGecko(),
  ])

  const prices: TokenPrice[] = []
  const statuses: DexStatus[] = []

  for (const r of results) {
    if (r.status === 'fulfilled') {
      prices.push(...r.value.prices)
      statuses.push(r.value.status)
    }
  }

  return { prices, statuses }
}
