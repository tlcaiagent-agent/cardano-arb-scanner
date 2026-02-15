import { NextRequest, NextResponse } from 'next/server'

/**
 * Server-side trade execution using hot wallet.
 * Signs transactions with seed phrase from env var — no browser wallet needed.
 * 
 * POST /api/trade/execute
 * Body: { dex, tokenPair, amount, slippage, rawAmount? }
 *   - tokenPair: "ADA/MIN" or "MIN/ADA" etc
 *   - amount: amount in human-readable units (ADA for ADA sells)
 *   - rawAmount: optional raw on-chain amount for token sells (bypasses conversion)
 *   - slippage: percentage e.g. 2 for 2%
 * Returns: { success, txHash, estimatedOutput, ... }
 */

const DEXHUNTER_API = 'https://api-us.dexhunterv3.app'
const DEXHUNTER_PARTNER_KEY = process.env.DEXHUNTER_API_KEY || ''
const BLOCKFROST_URL = 'https://cardano-mainnet.blockfrost.io/api/v0'
const BLOCKFROST_KEY = process.env.BLOCKFROST_API_KEY || ''

// Safety rails
const MAX_TRADE_ADA = 200
const MIN_BALANCE_RESERVE_ADA = 10

const TOKEN_UNITS: Record<string, string> = {
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

// Reverse lookup: unit → symbol
const UNIT_TO_SYMBOL: Record<string, string> = {}
for (const [sym, unit] of Object.entries(TOKEN_UNITS)) {
  UNIT_TO_SYMBOL[unit] = sym
}

async function initLucid() {
  const seedPhrase = process.env.CARDANO_SEED_PHRASE
  if (!seedPhrase) throw new Error('Server wallet not configured (CARDANO_SEED_PHRASE missing)')
  
  const { Lucid, Blockfrost } = await import('lucid-cardano')
  const lucid = await Lucid.new(
    new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY),
    'Mainnet'
  )
  lucid.selectWalletFromSeed(seedPhrase)
  return lucid
}

async function getWalletInfo(address: string) {
  const resp = await fetch(`${BLOCKFROST_URL}/addresses/${address}`, {
    headers: { project_id: BLOCKFROST_KEY },
  })
  if (!resp.ok) return { balanceAda: 0, tokens: {} as Record<string, number> }
  const data = await resp.json()
  
  let balanceAda = 0
  const tokens: Record<string, number> = {}
  
  for (const a of (data.amount || [])) {
    if (a.unit === 'lovelace') {
      balanceAda = parseInt(a.quantity) / 1_000_000
    } else {
      tokens[a.unit] = parseInt(a.quantity)
    }
  }
  
  return { balanceAda, tokens }
}

// Pre-flight estimate: get exact fees before committing
async function estimateSwap(tokenIn: string, tokenOut: string, amountIn: number, slippage: number) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (DEXHUNTER_PARTNER_KEY) headers['X-Partner-Id'] = DEXHUNTER_PARTNER_KEY

  const resp = await fetch(`${DEXHUNTER_API}/swap/estimate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ token_in: tokenIn, token_out: tokenOut, amount_in: amountIn, slippage, blacklisted_dexes: [] }),
  })
  if (!resp.ok) return null
  const data = await resp.json()
  return {
    totalOutput: data.total_output as number,
    totalOutputNoSlippage: data.total_output_without_slippage as number,
    dexhunterFee: data.dexhunter_fee as number,
    batcherFee: data.batcher_fee as number,
    totalFee: data.total_fee as number,
    deposits: data.deposits as number,
    splits: data.splits,
  }
}

async function buildAndSignSwap(
  lucid: Awaited<ReturnType<typeof initLucid>>,
  walletAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
  slippage: number,
) {
  const buildHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  if (DEXHUNTER_PARTNER_KEY) buildHeaders['X-Partner-Id'] = DEXHUNTER_PARTNER_KEY

  const buildBody = {
    buyer_address: walletAddress,
    token_in: tokenIn,
    token_out: tokenOut,
    amount_in: amountIn,
    slippage,
    blacklisted_dexes: [],
  }

  console.log('[trade/execute] DexHunter build request:', JSON.stringify({ ...buildBody, buyer_address: buildBody.buyer_address.slice(0, 20) + '...' }))

  const buildResp = await fetch(`${DEXHUNTER_API}/swap/build`, {
    method: 'POST',
    headers: buildHeaders,
    body: JSON.stringify(buildBody),
  })

  if (!buildResp.ok) {
    const errText = await buildResp.text().catch(() => 'unknown')
    throw new Error(`DexHunter build failed (${buildResp.status}): ${errText}`)
  }

  const buildData = await buildResp.json()
  const txCbor = buildData.cbor

  if (!txCbor) {
    throw new Error(`DexHunter returned no CBOR: ${JSON.stringify(buildData).slice(0, 200)}`)
  }

  // Sign with Lucid
  console.log('[trade/execute] Signing transaction...')
  const tx = lucid.fromTx(txCbor)
  const signedTx = await tx.sign().complete()
  
  // Submit via Lucid/Blockfrost
  const txHash = await signedTx.submit()
  console.log('[trade/execute] TX submitted:', txHash)

  return {
    txHash,
    estimatedOutput: buildData.total_output,
    splits: buildData.splits,
  }
}

// Wait for tx confirmation by polling Blockfrost
async function waitForConfirmation(txHash: string, maxWaitMs = 120_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch(`${BLOCKFROST_URL}/txs/${txHash}`, {
        headers: { project_id: BLOCKFROST_KEY },
      })
      if (resp.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 5000))
  }
  return false
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { dex, tokenPair, amount, slippage, rawAmount, mode } = body

    // Validate inputs
    if (!tokenPair || !slippage) {
      return NextResponse.json({ success: false, error: 'Missing required fields: tokenPair, slippage' }, { status: 400 })
    }
    if (!amount && !rawAmount) {
      return NextResponse.json({ success: false, error: 'Missing amount or rawAmount' }, { status: 400 })
    }

    if (!BLOCKFROST_KEY) {
      return NextResponse.json({ success: false, error: 'Blockfrost API key not configured' }, { status: 500 })
    }

    const [tokenA, tokenB] = tokenPair.split('/')
    const sellUnit = TOKEN_UNITS[tokenA]
    const buyUnit = TOKEN_UNITS[tokenB]

    if (!sellUnit || !buyUnit) {
      return NextResponse.json({ success: false, error: `Unknown token in pair: ${tokenPair}` }, { status: 400 })
    }

    const isSellingAda = tokenA === 'ADA'

    // Safety check: only enforce ADA max for ADA sells (buy leg)
    if (isSellingAda && amount > MAX_TRADE_ADA) {
      return NextResponse.json({ success: false, error: `Trade size ${amount} ADA exceeds max ${MAX_TRADE_ADA} ADA` }, { status: 400 })
    }

    // Initialize Lucid
    const lucid = await initLucid()
    const walletAddress = await lucid.wallet.address()
    const walletInfo = await getWalletInfo(walletAddress)

    // Balance checks
    if (isSellingAda) {
      if (walletInfo.balanceAda < amount + MIN_BALANCE_RESERVE_ADA) {
        return NextResponse.json({
          success: false,
          error: `Insufficient ADA: have ${walletInfo.balanceAda.toFixed(2)}, need ${(amount + MIN_BALANCE_RESERVE_ADA).toFixed(2)} (incl. ${MIN_BALANCE_RESERVE_ADA} reserve)`,
        }, { status: 400 })
      }
    } else {
      // Selling a token — check we have it
      const tokenBalance = walletInfo.tokens[sellUnit] || 0
      const sellRaw = rawAmount || amount
      if (tokenBalance < sellRaw) {
        return NextResponse.json({
          success: false,
          error: `Insufficient ${tokenA}: have ${tokenBalance} raw units, need ${sellRaw}`,
        }, { status: 400 })
      }
      // Also need some ADA for fees
      if (walletInfo.balanceAda < MIN_BALANCE_RESERVE_ADA) {
        return NextResponse.json({
          success: false,
          error: `Insufficient ADA for fees: have ${walletInfo.balanceAda.toFixed(2)}, need at least ${MIN_BALANCE_RESERVE_ADA}`,
        }, { status: 400 })
      }
    }

    // === ARBITRAGE MODE: buy then sell in sequence ===
    if (mode === 'arbitrage') {
      const { buyDex, sellDex } = body
      const tokenOutUnit = buyUnit === 'lovelace' ? '' : buyUnit

      // === PRE-FLIGHT: Estimate both legs and check profitability ===
      console.log(`[arb] Pre-flight: estimating ${amount} ADA → ${tokenB} → ADA`)
      
      const buyEstimate = await estimateSwap('', tokenOutUnit, amount, slippage)
      if (!buyEstimate) {
        return NextResponse.json({ success: false, error: 'Failed to estimate buy leg' }, { status: 502 })
      }

      const sellEstimate = await estimateSwap(tokenOutUnit, '', buyEstimate.totalOutput, slippage)
      if (!sellEstimate) {
        return NextResponse.json({ success: false, error: 'Failed to estimate sell leg' }, { status: 502 })
      }

      // Calculate total fees and expected profit
      const buyFees = (buyEstimate.dexhunterFee || 0) + (buyEstimate.batcherFee || 0) + 0.3 // +0.3 for network fee
      const sellFees = (sellEstimate.dexhunterFee || 0) + (sellEstimate.batcherFee || 0) + 0.3
      const totalFees = buyFees + sellFees
      const expectedReturn = sellEstimate.totalOutput || 0
      const expectedProfit = expectedReturn - amount - totalFees

      console.log(`[arb] Pre-flight results:`)
      console.log(`  Buy:  ${amount} ADA → ${buyEstimate.totalOutput} ${tokenB} (fees: ${buyFees.toFixed(2)} ADA)`)
      console.log(`  Sell: ${buyEstimate.totalOutput} ${tokenB} → ${expectedReturn.toFixed(2)} ADA (fees: ${sellFees.toFixed(2)} ADA)`)
      console.log(`  Total fees: ${totalFees.toFixed(2)} ADA`)
      console.log(`  Expected profit: ${expectedProfit.toFixed(2)} ADA`)

      if (expectedProfit <= 0) {
        return NextResponse.json({
          success: false,
          error: `Trade would LOSE money. Expected: ${expectedReturn.toFixed(2)} ADA back from ${amount} ADA invested. Total fees: ${totalFees.toFixed(2)} ADA. Net: ${expectedProfit.toFixed(2)} ADA`,
          preflight: {
            buyOutput: buyEstimate.totalOutput,
            sellOutput: expectedReturn,
            buyFees,
            sellFees,
            totalFees,
            expectedProfit,
          },
        }, { status: 400 })
      }

      console.log(`[arb] ✅ Pre-flight passed. Expected profit: ${expectedProfit.toFixed(2)} ADA. Executing...`)

      // Step 1: Buy token (ADA → Token)
      console.log(`[arb] Step 1: Buy ${tokenB} with ${amount} ADA on ${buyDex || 'best'}`)
      const buyResult = await buildAndSignSwap(
        lucid, walletAddress,
        '', // ADA in
        buyUnit === 'lovelace' ? '' : buyUnit,
        amount,
        slippage,
      )

      console.log(`[arb] Buy tx: ${buyResult.txHash}, estimated output: ${buyResult.estimatedOutput}`)

      // Step 2: Wait for buy confirmation
      console.log('[arb] Waiting for buy confirmation...')
      const confirmed = await waitForConfirmation(buyResult.txHash, 120_000)
      if (!confirmed) {
        return NextResponse.json({
          success: false,
          error: 'Buy tx not confirmed within 2 minutes',
          buyTxHash: buyResult.txHash,
        })
      }

      // Step 3: Check how many tokens we actually received
      await new Promise(r => setTimeout(r, 3000)) // Brief delay for UTxO indexing
      const postBuyInfo = await getWalletInfo(walletAddress)
      const tokenReceived = postBuyInfo.tokens[buyUnit === 'lovelace' ? '' : buyUnit] || 0
      
      // Use estimated output as the sell amount (DexHunter gives us this in human-readable)
      const sellAmount = buyResult.estimatedOutput || amount
      
      console.log(`[arb] Step 3: Sell ${sellAmount} ${tokenB} for ADA on ${sellDex || 'best'}`)

      // Step 4: Sell token back to ADA (Token → ADA)
      const sellResult = await buildAndSignSwap(
        lucid, walletAddress,
        buyUnit === 'lovelace' ? '' : buyUnit,
        '', // ADA out
        sellAmount,
        slippage,
      )

      return NextResponse.json({
        success: true,
        mode: 'arbitrage',
        buyTxHash: buyResult.txHash,
        sellTxHash: sellResult.txHash,
        buyEstimatedOutput: buyResult.estimatedOutput,
        sellEstimatedOutput: sellResult.estimatedOutput,
        netProfitAda: (sellResult.estimatedOutput || 0) - amount,
        fees: {
          buy: buyFees,
          sell: sellFees,
          total: totalFees,
          preflightProfit: expectedProfit,
        },
        walletAddress,
        source: 'server-wallet',
      })
    }

    // === SINGLE SWAP MODE ===
    const tokenIn = sellUnit === 'lovelace' ? '' : sellUnit
    const tokenOut = buyUnit === 'lovelace' ? '' : buyUnit
    const sellAmount = rawAmount || amount

    const result = await buildAndSignSwap(lucid, walletAddress, tokenIn, tokenOut, sellAmount, slippage)

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      estimatedOutput: result.estimatedOutput,
      walletAddress,
      source: 'server-wallet',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[trade/execute] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
