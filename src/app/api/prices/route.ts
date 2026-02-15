import { NextResponse } from 'next/server'
import { fetchAllPrices } from '@/lib/dex-fetchers'
import { PriceResponse } from '@/lib/types'
import { CACHE_TTL_MS } from '@/lib/constants'

let cache: { data: PriceResponse; ts: number } | null = null

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data)
  }

  const { prices, statuses } = await fetchAllPrices()
  const isDemo = statuses.every(s => s.status === 'demo')

  const resp: PriceResponse = {
    prices,
    dexStatuses: statuses,
    isDemo,
    timestamp: Date.now(),
  }

  cache = { data: resp, ts: Date.now() }
  return NextResponse.json(resp)
}
