export interface TokenPrice {
  tokenA: string
  tokenB: string
  pair: string
  dex: string
  price: number
  liquidity: number
  buyLiquidityAda?: number   // estimated buy-side pool depth in ADA
  sellLiquidityAda?: number  // estimated sell-side pool depth in ADA
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
  buyLiquidityAda: number   // buy-side pool depth in ADA
  sellLiquidityAda: number  // sell-side pool depth in ADA
  netProfitAda: number
  timestamp: number
  tier: 'green' | 'yellow' | 'red'
}

export interface TriangularArb {
  id: string
  dex: string
  route: string[]
  legs: { from: string; to: string; price: number }[]
  profitPct: number
  estimatedProfitAda: number
  timestamp: number
}

export interface DexStatus {
  name: string
  status: 'live' | 'stale' | 'demo'
  lastUpdate: number
  pairCount: number
  responseTimeMs?: number
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
  dexStatuses: DexStatus[]
  isDemo: boolean
}

// Phase 3 types

export interface ExecutionPlan {
  id: string
  pair: string
  tokenA: string
  tokenB: string
  buyDex: string
  sellDex: string
  buyPrice: number
  sellPrice: number
  spreadPct: number
  amount: number
  slippage: number
  steps: ExecutionStep[]
  estimatedProfit: number
  netProfit: number
  requiredCapital: number
  timeSensitivity: string
  buyDexUrl: string
  sellDexUrl: string
}

export interface ExecutionStep {
  step: number
  action: string
  details: string
  estimatedFee: number
}

export interface ExecuteRequest {
  pair: string
  buyDex: string
  sellDex: string
  amount: number
  slippage: number
}

export interface ExecuteResponse {
  success: boolean
  plan: ExecutionPlan
  message: string
}

export interface TradeRecord {
  id: string
  timestamp: number
  pair: string
  buyDex: string
  sellDex: string
  spreadPct: number
  profitAda: number
  amount: number
  status: 'planned' | 'executed' | 'failed' | 'manual' | 'dry-run'
  buyPrice?: number
  sellPrice?: number
  fees?: number
  buyTxHash?: string
  sellTxHash?: string
  dryRun?: boolean
}

export interface ExecutionConfig {
  tradeSize: number
  minProfit: number
  maxSlippage: number
  autoExecute: boolean
  riskLevel: 'conservative' | 'moderate' | 'aggressive'
}
