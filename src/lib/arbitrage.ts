import { TokenPrice, ArbOpportunity, TriangularArb } from './types'
import { DEX_FEES, TX_FEE_ADA, DEFAULT_TRADE_SIZE_ADA } from './constants'

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

        // Calculate profit
        const tokensAcquired = tradeSize / buy.price
        const grossReturn = tokensAcquired * sell.price
        const buyFee = tradeSize * (DEX_FEES[buy.dex] || 0.003)
        const sellFee = grossReturn * (DEX_FEES[sell.dex] || 0.003)
        const netProfit = grossReturn - tradeSize - buyFee - sellFee - TX_FEE_ADA * 2

        const tier: ArbOpportunity['tier'] =
          spreadPct > 2 ? 'green' : spreadPct > 1 ? 'yellow' : 'red'

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

  return opps.sort((a, b) => b.spreadPct - a.spreadPct)
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
    // Try ADA -> X -> Y -> ADA
    for (const tokenB of tokens) {
      for (const tokenC of tokens) {
        if (tokenB === tokenC) continue

        const leg1 = pairMap.get(`ADA/${tokenB}`)
        const leg2Key = `${tokenB}/${tokenC}`
        const leg2Alt = `ADA/${tokenC}`
        const leg3 = pairMap.get(`ADA/${tokenC}`)

        // Simplified: ADA->B (buy B), if B->C exists, then C->ADA (sell C)
        // For demo we simulate with ADA pairs only
        if (!leg1 || !leg3) continue
        if (leg1.price === 0 || leg3.price === 0) continue

        // ADA -> tokenB -> tokenC -> ADA
        // Buy tokenB with ADA, convert tokenB to tokenC (simulated), sell tokenC for ADA
        const bAmount = tradeSize / leg1.price
        // Simulate B->C conversion with a small random spread
        const cAmount = bAmount * (leg1.price / leg3.price) * (1 + (Math.random() - 0.5) * 0.02)
        const returnAda = cAmount * leg3.price
        const fees = tradeSize * 0.003 * 3 + TX_FEE_ADA * 3
        const profitPct = ((returnAda - tradeSize - fees) / tradeSize) * 100

        if (profitPct > -1 && profitPct < 5) {
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
