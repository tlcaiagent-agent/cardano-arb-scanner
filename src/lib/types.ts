export interface TokenPrice {
  tokenA: string
  tokenB: string
  pair: string          // "ADA/HOSKY"
  dex: string
  price: number         // price of tokenB in tokenA
  liquidity: number     // in ADA
  timestamp: number
}

export interface ArbOpportunity {
  id: string
  pair: string
  tokenA: string
  tokenB: string
  buyDex: string
  sellDex: string
  buyPrice: number
  sellPrice: number
  spreadPct: number
  estimatedProfitAda: number
  buyLiquidity: number
  sellLiquidity: number
  netProfitAda: number   // after fees
  timestamp: number
  tier: 'green' | 'yellow' | 'red'
}

export interface TriangularArb {
  id: string
  dex: string
  route: string[]       // ["ADA", "MIN", "SUNDAE", "ADA"]
  legs: { from: string; to: string; price: number }[]
  profitPct: number
  estimatedProfitAda: number
  timestamp: number
}

export interface DexStatus {
  name: string
  status: 'live' | 'error' | 'demo'
  lastUpdate: number
  pairCount: number
}

export interface PriceResponse {
  prices: TokenPrice[]
  dexStatuses: DexStatus[]
  isDemo: boolean
  timestamp: number
}

export interface ArbResponse {
  opportunities: ArbOpportunity[]
  triangular: TriangularArb[]
  stats: {
    totalOpportunities: number
    avgSpread: number
    bestSpread: number
    lastUpdate: number
  }
  isDemo: boolean
}
