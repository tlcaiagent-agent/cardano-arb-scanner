import { NextRequest, NextResponse } from 'next/server'

const BLOCKFROST_URL = 'https://cardano-mainnet.blockfrost.io/api/v0'
const BLOCKFROST_KEY = process.env.BLOCKFROST_API_KEY || ''
const MUESLI_API = 'https://api.muesliswap.com'
const DEXHUNTER_API = 'https://api-us.dexhunter.io/community'
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || ''

// Token policy IDs for common tokens
const TOKEN_POLICIES: Record<string, { policyId: string; assetName: string }> = {
  ADA: { policyId: '', assetName: '' }, // lovelace
  HOSKY: { policyId: 'a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235', assetName: '484f534b59' },
  MIN: { policyId: '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6', assetName: '4d494e' },
  SNEK: { policyId: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f', assetName: '534e454b' },
  SUNDAE: { policyId: '9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d77', assetName: '53554e444145' },
  INDY: { policyId: '533bb94a8850ee3ccbe483106eb230d7b7a2e2ad25a830d2f542e8c5', assetName: '494e4459' },
  WMT: { policyId: '1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e', assetName: '776f726c646d6f62696c65746f6b656e' },
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'build':
        return handleBuild(body)
      case 'submit':
        return handleSubmit(body)
      case 'status':
        return handleTxStatus(body)
      case 'notify':
        return handleNotify(body)
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

async function handleBuild(body: {
  pair: string
  dex: string
  direction: 'buy' | 'sell'
  amount: number
  slippage: number
  walletAddress: string
}) {
  const { pair, dex, direction, amount, slippage, walletAddress } = body
  const [tokenA, tokenB] = pair.split('/')

  // Try MuesliSwap aggregator first
  try {
    const sellToken = direction === 'buy' ? TOKEN_POLICIES['ADA'] : TOKEN_POLICIES[tokenB]
    const buyToken = direction === 'buy' ? TOKEN_POLICIES[tokenB] : TOKEN_POLICIES['ADA']

    if (!sellToken || !buyToken) {
      throw new Error(`Unknown token in pair ${pair}`)
    }

    const lovelaceAmount = direction === 'buy' ? Math.floor(amount * 1_000_000) : amount

    // MuesliSwap aggregator endpoint
    const muesliResp = await fetch(`${MUESLI_API}/v1/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        sell: {
          policyId: sellToken.policyId,
          assetName: sellToken.assetName,
          amount: lovelaceAmount.toString(),
        },
        buy: {
          policyId: buyToken.policyId,
          assetName: buyToken.assetName,
        },
        slippage: slippage / 100,
        dex: dex.toLowerCase(),
      }),
    })

    if (muesliResp.ok) {
      const data = await muesliResp.json()
      return NextResponse.json({
        success: true,
        txCbor: data.cbor || data.tx || data.transaction,
        estimatedOutput: data.estimatedOutput,
        priceImpact: data.priceImpact,
        source: 'muesliswap',
      })
    }

    // Fallback to DexHunter
    const dexHunterResp = await fetch(`${DEXHUNTER_API}/swap-build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: walletAddress,
        sell_token: sellToken.policyId ? `${sellToken.policyId}.${sellToken.assetName}` : 'lovelace',
        buy_token: buyToken.policyId ? `${buyToken.policyId}.${buyToken.assetName}` : 'lovelace',
        amount: lovelaceAmount.toString(),
        slippage: slippage,
      }),
    })

    if (dexHunterResp.ok) {
      const data = await dexHunterResp.json()
      return NextResponse.json({
        success: true,
        txCbor: data.cbor || data.tx,
        estimatedOutput: data.estimatedOutput,
        source: 'dexhunter',
      })
    }

    // Both failed - return mock for development
    return NextResponse.json({
      success: true,
      txCbor: null,
      mock: true,
      message: 'Aggregator APIs unavailable. In production, this would return unsigned transaction CBOR.',
      estimatedOutput: direction === 'buy' ? amount * 1000 : amount / 1000,
      source: 'mock',
    })
  } catch (e) {
    return NextResponse.json({
      success: true,
      txCbor: null,
      mock: true,
      message: `Build fallback: ${e instanceof Error ? e.message : 'API error'}`,
      source: 'mock',
    })
  }
}

async function handleSubmit(body: { signedTx: string }) {
  const { signedTx } = body

  if (!signedTx) {
    return NextResponse.json({ error: 'Missing signedTx' }, { status: 400 })
  }

  // Submit via Blockfrost
  if (BLOCKFROST_KEY) {
    try {
      const resp = await fetch(`${BLOCKFROST_URL}/tx/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/cbor',
          'project_id': BLOCKFROST_KEY,
        },
        body: hexToBuffer(signedTx),
      })

      if (resp.ok) {
        const txHash = await resp.text()
        return NextResponse.json({ success: true, txHash: txHash.replace(/"/g, '') })
      } else {
        const err = await resp.text()
        return NextResponse.json({ success: false, error: `Blockfrost: ${err}` }, { status: 400 })
      }
    } catch (e) {
      return NextResponse.json({ success: false, error: `Submit error: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 })
    }
  }

  // No Blockfrost key - return mock
  return NextResponse.json({
    success: true,
    txHash: null,
    mock: true,
    message: 'BLOCKFROST_API_KEY not configured. Set it in .env to enable real submissions.',
  })
}

async function handleTxStatus(body: { txHash: string }) {
  const { txHash } = body

  if (BLOCKFROST_KEY && txHash) {
    try {
      const resp = await fetch(`${BLOCKFROST_URL}/txs/${txHash}`, {
        headers: { 'project_id': BLOCKFROST_KEY },
      })
      if (resp.ok) {
        const data = await resp.json()
        return NextResponse.json({
          confirmed: true,
          block: data.block,
          blockHeight: data.block_height,
          fees: parseInt(data.fees) / 1_000_000,
        })
      }
      return NextResponse.json({ confirmed: false })
    } catch {
      return NextResponse.json({ confirmed: false })
    }
  }

  return NextResponse.json({ confirmed: false, mock: true })
}

async function handleNotify(body: { trade: Record<string, unknown> }) {
  if (!DISCORD_WEBHOOK) {
    return NextResponse.json({ sent: false, reason: 'No webhook configured' })
  }

  const t = body.trade as Record<string, unknown>
  const profitable = (t.netProfit as number) > 0
  const emoji = profitable ? '💰' : '📉'
  const mode = t.dryRun ? '🟡 DRY RUN' : '🔴 LIVE'

  const content = [
    `${emoji} **${mode} Trade** — ${t.pair}`,
    `Buy: ${t.buyDex} → Sell: ${t.sellDex}`,
    `Amount: ${t.amount} ₳ | P&L: ${(t.netProfit as number) > 0 ? '+' : ''}${(t.netProfit as number).toFixed(2)} ₳`,
    t.buyTxHash ? `Buy TX: [${(t.buyTxHash as string).slice(0, 16)}...](https://cardanoscan.io/transaction/${t.buyTxHash})` : '',
    t.sellTxHash ? `Sell TX: [${(t.sellTxHash as string).slice(0, 16)}...](https://cardanoscan.io/transaction/${t.sellTxHash})` : '',
  ].filter(Boolean).join('\n')

  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    return NextResponse.json({ sent: true })
  } catch {
    return NextResponse.json({ sent: false })
  }
}

function hexToBuffer(hex: string): ArrayBuffer {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16)
  }
  return bytes.buffer
}
