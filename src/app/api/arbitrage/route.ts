import { NextRequest, NextResponse } from 'next/server'
import { fetchAllPrices } from '@/lib/dex-fetchers'
import { findArbOpportunities, findTriangularArbs } from '@/lib/arbitrage'
import { ArbResponse } from '@/lib/types'
import { CACHE_TTL_MS, DEFAULT_TRADE_SIZE_ADA } from '@/lib/constants'

let cache: { data: ArbResponse; ts: number } | null = null

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tradeSize = parseFloat(sp.get('tradeSize') || '') || DEFAULT_TRADE_SIZE_ADA
  const minSpread = parseFloat(sp.get('minSpread') || '') || 0

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS && tradeSize === DEFAULT_TRADE_SIZE_ADA && minSpread === 0) {
    return NextResponse.json(cache.data)
  }

  const { prices, statuses } = await fetchAllPrices()
  const opportunities = findArbOpportunities(prices, tradeSize, minSpread)
  const triangular = findTriangularArbs(prices, tradeSize)
  const isDemo = statuses.every(s => s.status === 'demo')

  const resp: ArbResponse = {
    opportunities,
    triangular,
    stats: {
      totalOpportunities: opportunities.length,
      avgSpread: opportunities.length ? opportunities.reduce((s, o) => s + o.spreadPct, 0) / opportunities.length : 0,
      bestSpread: opportunities[0]?.spreadPct || 0,
      lastUpdate: Date.now(),
    },
    dexStatuses: statuses,
    isDemo,
  }

  if (tradeSize === DEFAULT_TRADE_SIZE_ADA && minSpread === 0) {
    cache = { data: resp, ts: Date.now() }
  }
  return NextResponse.json(resp)
}
