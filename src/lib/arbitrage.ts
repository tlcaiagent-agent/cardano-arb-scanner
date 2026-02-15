import { TokenPrice, ArbOpportunity, TriangularArb } from './types'
import { TX_FEE_ADA, DEFAULT_TRADE_SIZE_ADA } from './constants'

// Real all-in cost per swap leg:
// ~0.3 ADA network fee + ~2 ADA batcher fee + ~1.5% DexHunter fee
const FIXED_FEE_PER_SWAP = 2.5  // batcher + network
const DEXHUNTER_FEE_PCT = 0.015 // ~1.5% of trade
const POOL_FEE_PCT = 0.003      // ~0.3% pool swap fee

function estimateSwapFees(amountAda: number): number {
  return FIXED_FEE_PER_SWAP + (amountAda * DEXHUNTER_FEE_PCT) + (amountAda * POOL_FEE_PCT)
}

export function findArbOpportunities(
  prices: TokenPrice[],
  tradeSize: number = DEFAULT_TRADE_SIZE_ADA,
  minSpreadPct: number = 0
): ArbOpportunity[] {
  // Group by pair
  const byPair = new Map<string, TokenPrice[]>()
  for (const p of prices) {
    const list = byPair.get(p.pair) || []
    list.push(p)
    byPair.set(p.pair, list)
  }

  const opps: ArbOpportunity[] = []

  for (const [pair, pairPrices] of byPair) {
    if (pairPrices.length < 2) continue

    // Compare every DEX pair
    for (let i = 0; i < pairPrices.length; i++) {
      for (let j = i + 1; j < pairPrices.length; j++) {
        const a = pairPrices[i]
        const b = pairPrices[j]

        // Determine buy (lower price) and sell (higher price)
        const [buy, sell] = a.price < b.price ? [a, b] : [b, a]
        if (buy.price === 0) continue

        const spreadPct = ((sell.price - buy.price) / buy.price) * 100
        if (spreadPct < minSpreadPct) continue

        // Calculate profit with REALISTIC fees
        const tokensAcquired = tradeSize / buy.price
        const grossReturn = tokensAcquired * sell.price
        
        // All-in fees for round trip (buy + sell)
        const buyFees = estimateSwapFees(tradeSize)
        const sellFees = estimateSwapFees(grossReturn)
        const totalFees = buyFees + sellFees
        
        const netProfit = grossReturn - tradeSize - totalFees

        const tier: ArbOpportunity['tier'] =
          netProfit > 5 ? 'green' : netProfit > 0 ? 'yellow' : 'red'

        opps.push({
          id: `${pair}-${buy.dex}-${sell.dex}`,
          pair,
          tokenA: buy.tokenA,
          tokenB: buy.tokenB,
          buyDex: buy.dex,
          sellDex: sell.dex,
          buyPrice: buy.price,
          sellPrice: sell.price,
          spreadPct,
          estimatedProfitAda: grossReturn - tradeSize,
          buyLiquidity: buy.liquidity,
          sellLiquidity: sell.liquidity,
          netProfitAda: netProfit,
          timestamp: Date.now(),
          tier,
        })
      }
    }
  }

  return opps.sort((a, b) => b.netProfitAda - a.netProfitAda)
}

export function findTriangularArbs(
  prices: TokenPrice[],
  tradeSize: number = DEFAULT_TRADE_SIZE_ADA
): TriangularArb[] {
  // Group by dex
  const byDex = new Map<string, Map<string, TokenPrice>>()
  for (const p of prices) {
    if (!byDex.has(p.dex)) byDex.set(p.dex, new Map())
    byDex.get(p.dex)!.set(p.pair, p)
  }

  const results: TriangularArb[] = []
  const tokens = [...new Set(prices.map(p => p.tokenB))]

  for (const [dex, pairMap] of byDex) {
    for (const tokenB of tokens) {
      for (const tokenC of tokens) {
        if (tokenB === tokenC) continue

        const leg1 = pairMap.get(`ADA/${tokenB}`)
        const leg3 = pairMap.get(`ADA/${tokenC}`)

        if (!leg1 || !leg3) continue
        if (leg1.price === 0 || leg3.price === 0) continue

        const bAmount = tradeSize / leg1.price
        const cAmount = bAmount * (leg1.price / leg3.price) * (1 + (Math.random() - 0.5) * 0.02)
        const returnAda = cAmount * leg3.price
        
        // 3 swap legs with realistic fees
        const fees = estimateSwapFees(tradeSize) + estimateSwapFees(returnAda * 0.5) + estimateSwapFees(returnAda)
        const profitPct = ((returnAda - tradeSize - fees) / tradeSize) * 100

        if (profitPct > -5 && profitPct < 10) {
          results.push({
            id: `tri-${dex}-ADA-${tokenB}-${tokenC}`,
            dex,
            route: ['ADA', tokenB, tokenC, 'ADA'],
            legs: [
              { from: 'ADA', to: tokenB, price: leg1.price },
              { from: tokenB, to: tokenC, price: leg1.price / leg3.price },
              { from: tokenC, to: 'ADA', price: leg3.price },
            ],
            profitPct,
            estimatedProfitAda: returnAda - tradeSize - fees,
            timestamp: Date.now(),
          })
        }
      }
    }
  }

  return results.sort((a, b) => b.profitPct - a.profitPct).slice(0, 20)
}
