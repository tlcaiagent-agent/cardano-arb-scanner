import { NextRequest, NextResponse } from 'next/server'

/**
 * Server-side trade execution using hot wallet.
 * Signs transactions with seed phrase from env var — no browser wallet needed.
 * 
 * POST /api/trade/execute
 * Body: { dex, tokenPair, amount, slippage }
 * Returns: { success, txHash, ... }
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

async function getWalletAddress(): Promise<string> {
  const seedPhrase = process.env.CARDANO_SEED_PHRASE
  if (!seedPhrase) throw new Error('Server wallet not configured')

  const { Lucid, Blockfrost } = await import('lucid-cardano')
  const lucid = await Lucid.new(
    new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY),
    'Mainnet'
  )
  lucid.selectWalletFromSeed(seedPhrase)
  return await lucid.wallet.address()
}

async function getWalletBalanceAda(): Promise<number> {
  const address = await getWalletAddress()
  const resp = await fetch(`${BLOCKFROST_URL}/addresses/${address}`, {
    headers: { project_id: BLOCKFROST_KEY },
  })
  if (!resp.ok) return 0
  const data = await resp.json()
  const lovelace = data.amount?.find((a: { unit: string; quantity: string }) => a.unit === 'lovelace')
  return lovelace ? parseInt(lovelace.quantity) / 1_000_000 : 0
}

export async function POST(req: NextRequest) {
  try {
    const { dex, tokenPair, amount, slippage } = await req.json()

    // Validate inputs
    if (!tokenPair || !amount || !slippage) {
      return NextResponse.json({ success: false, error: 'Missing required fields: tokenPair, amount, slippage' }, { status: 400 })
    }

    if (amount > MAX_TRADE_ADA) {
      return NextResponse.json({ success: false, error: `Trade size ${amount} ADA exceeds max ${MAX_TRADE_ADA} ADA` }, { status: 400 })
    }

    if (amount <= 0) {
      return NextResponse.json({ success: false, error: 'Amount must be positive' }, { status: 400 })
    }

    const seedPhrase = process.env.CARDANO_SEED_PHRASE
    if (!seedPhrase) {
      return NextResponse.json({ success: false, error: 'Server wallet not configured (CARDANO_SEED_PHRASE missing)' }, { status: 500 })
    }

    if (!BLOCKFROST_KEY) {
      return NextResponse.json({ success: false, error: 'Blockfrost API key not configured' }, { status: 500 })
    }

    // Initialize Lucid with seed phrase
    const { Lucid, Blockfrost } = await import('lucid-cardano')
    const lucid = await Lucid.new(
      new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY),
      'Mainnet'
    )
    lucid.selectWalletFromSeed(seedPhrase)
    const walletAddress = await lucid.wallet.address()

    // Check balance
    const balance = await getWalletBalanceAda()
    if (balance < amount + MIN_BALANCE_RESERVE_ADA) {
      return NextResponse.json({
        success: false,
        error: `Insufficient balance: have ${balance.toFixed(2)} ADA, need ${(amount + MIN_BALANCE_RESERVE_ADA).toFixed(2)} ADA (including ${MIN_BALANCE_RESERVE_ADA} ADA reserve)`,
      }, { status: 400 })
    }

    // Parse token pair
    const [tokenA, tokenB] = tokenPair.split('/')
    const sellUnit = TOKEN_UNITS[tokenA]
    const buyUnit = TOKEN_UNITS[tokenB]

    if (!sellUnit || !buyUnit) {
      return NextResponse.json({ success: false, error: `Unknown token in pair: ${tokenPair}` }, { status: 400 })
    }

    // DexHunter takes amounts in ADA (not lovelace)
    const sellAmount = amount

    // Build swap tx via DexHunter v3
    const buildBody = {
      buyer_address: walletAddress,
      token_in: sellUnit === 'lovelace' ? '' : sellUnit,
      token_out: buyUnit === 'lovelace' ? '' : buyUnit,
      amount_in: sellAmount,
      slippage: slippage,
      blacklisted_dexes: [],
    }

    console.log('[trade/execute] Building swap via DexHunter for', tokenPair, 'amount:', amount, 'ADA')

    const buildHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (DEXHUNTER_PARTNER_KEY) buildHeaders['X-Partner-Id'] = DEXHUNTER_PARTNER_KEY

    const buildResp = await fetch(`${DEXHUNTER_API}/swap/build`, {
      method: 'POST',
      headers: buildHeaders,
      body: JSON.stringify(buildBody),
    })

    if (!buildResp.ok) {
      const errText = await buildResp.text().catch(() => 'unknown')
      return NextResponse.json({
        success: false,
        error: `DexHunter build failed (${buildResp.status}): ${errText}`,
      }, { status: 502 })
    }

    const buildData = await buildResp.json()
    const txCbor = buildData.cbor || buildData.tx || buildData.transaction

    if (!txCbor) {
      return NextResponse.json({
        success: false,
        error: 'DexHunter returned no transaction CBOR',
        buildResponse: buildData,
      }, { status: 502 })
    }

    // Sign with Lucid using the seed phrase
    console.log('[trade/execute] Signing transaction server-side...')
    const tx = lucid.fromTx(txCbor)
    const signedTx = await tx.sign().complete()

    // Try submitting via DexHunter /swap/sign endpoint first
    let txHash: string | undefined
    try {
      const signHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (DEXHUNTER_PARTNER_KEY) signHeaders['X-Partner-Id'] = DEXHUNTER_PARTNER_KEY

      const signResp = await fetch(`${DEXHUNTER_API}/swap/sign`, {
        method: 'POST',
        headers: signHeaders,
        body: JSON.stringify({
          txCbor: signedTx.toString(),
          signatures: [],
        }),
      })
      if (signResp.ok) {
        const signData = await signResp.json()
        if (signData.txHash || signData.tx_hash) {
          txHash = signData.txHash || signData.tx_hash
          console.log('[trade/execute] Submitted via DexHunter sign:', txHash)
        }
      }
    } catch (e) {
      console.warn('[trade/execute] DexHunter sign endpoint failed, falling back to direct submit:', e)
    }

    // Fallback: submit directly via Lucid/Blockfrost
    if (!txHash) {
      txHash = await signedTx.submit()
      console.log('[trade/execute] Submitted via Blockfrost:', txHash)
    }

    console.log('[trade/execute] Transaction submitted:', txHash)

    return NextResponse.json({
      success: true,
      txHash,
      walletAddress,
      estimatedOutput: buildData.estimated_output || buildData.estimatedOutput,
      source: 'server-wallet',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    // Never log seed phrase - but log other errors
    console.error('[trade/execute] Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
