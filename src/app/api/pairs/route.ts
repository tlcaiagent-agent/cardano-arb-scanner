import { NextResponse } from 'next/server'
import { fetchAllPrices } from '@/lib/dex-fetchers'

export async function GET() {
  const { prices } = await fetchAllPrices()
  const pairSet = new Map<string, { pair: string; dexes: string[]; avgPrice: number }>()

  for (const p of prices) {
    const existing = pairSet.get(p.pair)
    if (existing) {
      if (!existing.dexes.includes(p.dex)) existing.dexes.push(p.dex)
      existing.avgPrice = (existing.avgPrice + p.price) / 2
    } else {
      pairSet.set(p.pair, { pair: p.pair, dexes: [p.dex], avgPrice: p.price })
    }
  }

  return NextResponse.json({ pairs: Array.from(pairSet.values()) })
}
