import { TokenPrice, DexStatus } from './types'

// Each fetcher tries the real API first, falls back to demo data
// This architecture makes it easy to add new DEXs

interface FetchResult {
  prices: TokenPrice[]
  status: DexStatus
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

// ─── MuesliSwap (most reliable public API) ───
async function fetchMuesliSwap(): Promise<FetchResult> {
  const dex = 'MuesliSwap'
  try {
    const resp = await fetchWithTimeout('https://api.muesliswap.com/price', {
      headers: { 'Accept': 'application/json' }
    })
    if (!resp.ok) throw new Error(`${resp.status}`)
    const data = await resp.json()
    const prices: TokenPrice[] = []
    if (Array.isArray(data)) {
      for (const item of data.slice(0, 50)) {
        const symbol = item.info?.symbol || item.symbol
        if (!symbol) continue
        const price = parseFloat(item.price?.value || item.price || '0')
        if (!price || !isFinite(price)) continue
        prices.push({
          tokenA: 'ADA', tokenB: symbol,
          pair: `ADA/${symbol}`, dex,
          price, liquidity: parseFloat(item.liquidity || '10000'),
          timestamp: Date.now(),
        })
      }
    }
    if (prices.length === 0) throw new Error('No prices parsed')
    return {
      prices,
      status: { name: dex, status: 'live', lastUpdate: Date.now(), pairCount: prices.length }
    }
  } catch {
    return { prices: demoDataForDex(dex), status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0 } }
  }
}

// ─── Minswap ───
async function fetchMinswap(): Promise<FetchResult> {
  const dex = 'Minswap'
  try {
    const resp = await fetchWithTimeout('https://api-mainnet-prod.minswap.org/commerce/pools?page=1&limit=20', {
      headers: { 'Accept': 'application/json' }
    })
    if (!resp.ok) throw new Error(`${resp.status}`)
    const data = await resp.json()
    const prices: TokenPrice[] = []
    const pools = Array.isArray(data) ? data : data?.data || data?.pools || []
    for (const pool of pools.slice(0, 30)) {
      const symbol = pool?.tokenB?.symbol || pool?.pair?.split('/')[1]
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
    return {
      prices,
      status: { name: dex, status: 'live', lastUpdate: Date.now(), pairCount: prices.length }
    }
  } catch {
    return { prices: demoDataForDex(dex), status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0 } }
  }
}

// ─── SundaeSwap ───
async function fetchSundaeSwap(): Promise<FetchResult> {
  const dex = 'SundaeSwap'
  try {
    const resp = await fetchWithTimeout('https://stats.sundaeswap.finance/api/v1/pools', {
      headers: { 'Accept': 'application/json' }
    })
    if (!resp.ok) throw new Error(`${resp.status}`)
    const data = await resp.json()
    const prices: TokenPrice[] = []
    const pools = Array.isArray(data) ? data : data?.pools || []
    for (const pool of pools.slice(0, 30)) {
      const symbol = pool?.tokenB?.ticker || pool?.pair?.split('/')[1]
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
    return {
      prices,
      status: { name: dex, status: 'live', lastUpdate: Date.now(), pairCount: prices.length }
    }
  } catch {
    return { prices: demoDataForDex(dex), status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0 } }
  }
}

// ─── WingRiders ───
async function fetchWingRiders(): Promise<FetchResult> {
  const dex = 'WingRiders'
  try {
    const resp = await fetchWithTimeout('https://api.wingriders.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ pools(first: 20) { tokenA { symbol } tokenB { symbol } price tvl } }`
      })
    })
    if (!resp.ok) throw new Error(`${resp.status}`)
    const json = await resp.json()
    const pools = json?.data?.pools || []
    const prices: TokenPrice[] = []
    for (const pool of pools) {
      const symbol = pool?.tokenB?.symbol
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
    return {
      prices,
      status: { name: dex, status: 'live', lastUpdate: Date.now(), pairCount: prices.length }
    }
  } catch {
    return { prices: demoDataForDex(dex), status: { name: dex, status: 'demo', lastUpdate: Date.now(), pairCount: 0 } }
  }
}

// ─── Demo data generator ───
function demoDataForDex(dex: string): TokenPrice[] {
  const basePrices: Record<string, number> = {
    MIN: 0.042, SUNDAE: 0.0058, HOSKY: 0.000000058,
    WRT: 0.085, MILK: 0.32, SNEK: 0.0032,
    INDY: 1.85, LENFI: 0.78, OPTIM: 0.12,
    iUSD: 1.0, DJED: 1.0,
  }
  // Add per-dex variance to simulate real spreads
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
    fetchMinswap(),
    fetchSundaeSwap(),
    fetchWingRiders(),
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

  return { prices, statuses }
}
