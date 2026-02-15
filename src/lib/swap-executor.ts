/**
 * Phase 2: Real on-chain swap execution via DexHunter API + CIP-30 wallet signing.
 * 
 * Flow:
 *  1. Call DexHunter /swap/build to get unsigned transaction CBOR
 *  2. Sign with connected CIP-30 wallet
 *  3. Submit via wallet or Blockfrost
 *  4. Wait for confirmation
 * 
 * DexHunter handles routing across DEXs automatically.
 * We use their community API endpoint.
 */

import { WalletAPI } from './wallet'

// DexHunter community API
const DEXHUNTER_API = 'https://api-us.dexhunter.io/community'
const BLOCKFROST_URL = 'https://cardano-mainnet.blockfrost.io/api/v0'

// Token unit format: policyId + assetName hex, or "lovelace" for ADA
export const TOKEN_UNITS: Record<string, string> = {
  ADA: 'lovelace',
  HOSKY: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59',
  MIN: '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e',
  SUNDAE: '9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d7753554e444145',
  SNEK: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b',
  WRT: 'c0ee29a85b13209423b10447d3c2e6a50641a15c57770e27cb9d507357696e67526964657273',
  MILK: '8a1cfae21368b8bebbbed9800fec304e95cce39a2a57dc35e2e3ebaa4d494c4b',
  INDY: '533bb94a8850ee3ccbe483106489399112b74c905342cb1571b714e2494e4459',
  LENFI: '8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f695874c454e4649',
  DJED: '8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61446a65644d6963726f555344',
  iUSD: 'f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b6988069555344',
  AGIX: 'f43a62fdc3965df486de8a0d32fe800963589c41b38946602a8dc8e041474958',
  WMT: '1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e776f726c646d6f62696c65746f6b656e',
  NMKR: '5dac8536653edc12f6f5e1045d8164b9f59998d3bdc300fc928434894e4d4b52',
  JPG: 'da8c30857834c6ae7203935b89278c532b3995245295456f993e1d244a5047',
  GENS: 'dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb47454e53',
}

export interface SwapParams {
  walletAddress: string
  sellToken: string  // token symbol (ADA, MIN, etc.)
  buyToken: string   // token symbol
  sellAmount: number // in token's native unit (lovelace for ADA)
  slippagePct: number
  dex?: string       // optional: force specific DEX
}

export interface SwapResult {
  success: boolean
  txHash?: string
  estimatedOutput?: number
  actualFee?: number
  error?: string
  source: 'dexhunter' | 'wallet-submit' | 'blockfrost' | 'mock'
}

export interface SwapBuildResult {
  success: boolean
  txCbor?: string       // unsigned tx CBOR hex
  estimatedOutput?: number
  priceImpact?: number
  error?: string
  source: string
  mock?: boolean
}

/**
 * Build a swap transaction using DexHunter API.
 * Returns unsigned CBOR for wallet signing.
 */
export async function buildSwapTx(params: SwapParams): Promise<SwapBuildResult> {
  const sellUnit = TOKEN_UNITS[params.sellToken]
  const buyUnit = TOKEN_UNITS[params.buyToken]

  if (!sellUnit || !buyUnit) {
    return { success: false, error: `Unknown token: ${params.sellToken} or ${params.buyToken}`, source: 'error' }
  }

  // Try DexHunter community API
  try {
    const body = {
      address: params.walletAddress,
      sell_token: sellUnit,
      buy_token: buyUnit,
      sell_amount: params.sellAmount.toString(),
      slippage: params.slippagePct,
      ...(params.dex ? { dex: params.dex.toLowerCase() } : {}),
    }

    console.log('[SwapExecutor] Building swap via DexHunter:', JSON.stringify(body))

    const resp = await fetch(`${DEXHUNTER_API}/swap/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (resp.ok) {
      const data = await resp.json()
      console.log('[SwapExecutor] DexHunter build response:', JSON.stringify(data).slice(0, 200))

      if (data.cbor || data.tx || data.transaction) {
        return {
          success: true,
          txCbor: data.cbor || data.tx || data.transaction,
          estimatedOutput: data.estimated_output || data.estimatedOutput,
          priceImpact: data.price_impact || data.priceImpact,
          source: 'dexhunter',
        }
      }
    }

    const errText = await resp.text().catch(() => 'unknown error')
    console.warn('[SwapExecutor] DexHunter build failed:', resp.status, errText)
  } catch (e) {
    console.warn('[SwapExecutor] DexHunter error:', e)
  }

  // Try server-side build via our API route as fallback
  try {
    const resp = await fetch('/api/swap/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (resp.ok) {
      const data = await resp.json()
      if (data.txCbor) {
        return {
          success: true,
          txCbor: data.txCbor,
          estimatedOutput: data.estimatedOutput,
          source: data.source || 'server',
        }
      }
    }
  } catch (e) {
    console.warn('[SwapExecutor] Server build fallback failed:', e)
  }

  return {
    success: false,
    error: 'No swap aggregator available. DexHunter API may be down.',
    source: 'none',
    mock: true,
  }
}

/**
 * Sign and submit a transaction using CIP-30 wallet.
 */
export async function signAndSubmit(
  walletApi: WalletAPI,
  txCbor: string,
): Promise<{ txHash: string; source: string }> {
  // Sign with wallet
  console.log('[SwapExecutor] Requesting wallet signature...')
  const signedTx = await walletApi.signTx(txCbor, true)
  console.log('[SwapExecutor] Transaction signed, submitting...')

  // Try submitting via wallet first (preferred - uses wallet's node)
  try {
    const txHash = await walletApi.submitTx(signedTx)
    console.log('[SwapExecutor] Submitted via wallet, txHash:', txHash)
    return { txHash, source: 'wallet-submit' }
  } catch (e) {
    console.warn('[SwapExecutor] Wallet submit failed, trying Blockfrost:', e)
  }

  // Fallback: submit via Blockfrost through our API
  const resp = await fetch('/api/swap/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedTx }),
  })

  if (resp.ok) {
    const data = await resp.json()
    if (data.txHash) {
      console.log('[SwapExecutor] Submitted via Blockfrost, txHash:', data.txHash)
      return { txHash: data.txHash, source: 'blockfrost' }
    }
  }

  throw new Error('Failed to submit transaction via both wallet and Blockfrost')
}

/**
 * Wait for transaction confirmation by polling Blockfrost.
 * Returns fees paid once confirmed.
 */
export async function waitForConfirmation(
  txHash: string,
  maxWaitMs: number = 120_000,
  pollIntervalMs: number = 5_000,
): Promise<{ confirmed: boolean; fees?: number; block?: string }> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch('/api/swap/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      })

      if (resp.ok) {
        const data = await resp.json()
        if (data.confirmed) {
          return { confirmed: true, fees: data.fees, block: data.block }
        }
      }
    } catch {}

    await new Promise(r => setTimeout(r, pollIntervalMs))
  }

  return { confirmed: false }
}

/**
 * Execute a full arbitrage: buy on DEX A, wait, sell on DEX B.
 * Returns combined result.
 */
export async function executeArbitrage(
  walletApi: WalletAPI,
  walletAddress: string,
  params: {
    pair: string        // e.g. "ADA/MIN"
    buyDex: string
    sellDex: string
    amountAda: number   // ADA to spend
    slippagePct: number
    onStatus: (status: string, detail?: string) => void
  }
): Promise<{
  success: boolean
  buyTxHash?: string
  sellTxHash?: string
  totalFees: number
  netProfitAda?: number
  error?: string
}> {
  const { pair, buyDex, sellDex, amountAda, slippagePct, onStatus } = params
  const [tokenA, tokenB] = pair.split('/')

  // Step 1: Build buy swap (ADA → Token on cheaper DEX)
  onStatus('building-buy', `Building swap: ${amountAda} ADA → ${tokenB} on ${buyDex}`)
  const amountLovelace = Math.floor(amountAda * 1_000_000)

  const buyBuild = await buildSwapTx({
    walletAddress,
    sellToken: tokenA,
    buyToken: tokenB,
    sellAmount: amountLovelace,
    slippagePct,
    dex: buyDex,
  })

  if (!buyBuild.success || !buyBuild.txCbor) {
    return {
      success: false,
      totalFees: 0,
      error: buyBuild.mock
        ? `Swap aggregator unavailable (mock mode). Error: ${buyBuild.error}`
        : `Failed to build buy tx: ${buyBuild.error}`,
    }
  }

  // Step 2: Sign & submit buy tx
  onStatus('signing-buy', 'Waiting for wallet signature (buy)...')
  let buyTxHash: string
  try {
    const buyResult = await signAndSubmit(walletApi, buyBuild.txCbor)
    buyTxHash = buyResult.txHash
  } catch (e) {
    return {
      success: false,
      totalFees: 0,
      error: `Buy tx signing/submission failed: ${e instanceof Error ? e.message : 'unknown'}`,
    }
  }

  onStatus('confirming-buy', `Buy tx submitted: ${buyTxHash.slice(0, 16)}... Waiting for confirmation...`)

  // Step 3: Wait for buy confirmation
  const buyConfirm = await waitForConfirmation(buyTxHash)
  if (!buyConfirm.confirmed) {
    return {
      success: false,
      buyTxHash,
      totalFees: buyConfirm.fees || 0,
      error: 'Buy tx not confirmed within timeout',
    }
  }

  const buyFees = buyConfirm.fees || 0.2
  onStatus('building-sell', `Buy confirmed! Building sell: ${tokenB} → ADA on ${sellDex}`)

  // Step 4: Build sell swap (Token → ADA on more expensive DEX)
  // We need to figure out how many tokens we got — estimate from build output
  const tokensReceived = buyBuild.estimatedOutput || amountLovelace

  const sellBuild = await buildSwapTx({
    walletAddress,
    sellToken: tokenB,
    buyToken: tokenA,
    sellAmount: tokensReceived,
    slippagePct,
    dex: sellDex,
  })

  if (!sellBuild.success || !sellBuild.txCbor) {
    return {
      success: false,
      buyTxHash,
      totalFees: buyFees,
      error: `Failed to build sell tx: ${sellBuild.error}. You now hold ${tokenB} tokens.`,
    }
  }

  // Step 5: Sign & submit sell tx
  onStatus('signing-sell', 'Waiting for wallet signature (sell)...')
  let sellTxHash: string
  try {
    const sellResult = await signAndSubmit(walletApi, sellBuild.txCbor)
    sellTxHash = sellResult.txHash
  } catch (e) {
    return {
      success: false,
      buyTxHash,
      totalFees: buyFees,
      error: `Sell tx signing/submission failed: ${e instanceof Error ? e.message : 'unknown'}. You now hold ${tokenB} tokens.`,
    }
  }

  onStatus('confirming-sell', `Sell tx submitted: ${sellTxHash.slice(0, 16)}... Waiting for confirmation...`)

  // Step 6: Wait for sell confirmation
  const sellConfirm = await waitForConfirmation(sellTxHash)
  const sellFees = sellConfirm.fees || 0.2
  const totalFees = buyFees + sellFees

  if (!sellConfirm.confirmed) {
    return {
      success: false,
      buyTxHash,
      sellTxHash,
      totalFees,
      error: 'Sell tx not confirmed within timeout',
    }
  }

  onStatus('completed', `Arbitrage completed! Buy: ${buyTxHash.slice(0, 8)}... Sell: ${sellTxHash.slice(0, 8)}...`)

  return {
    success: true,
    buyTxHash,
    sellTxHash,
    totalFees,
  }
}
