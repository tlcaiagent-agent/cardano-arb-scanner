import { NextRequest, NextResponse } from 'next/server'

const DEXHUNTER_API = 'https://api-us.dexhunterv3.app'
const DEXHUNTER_PARTNER_KEY = process.env.DEXHUNTER_API_KEY || ''
const MUESLI_API = 'https://api.muesliswap.com'

// Same token units as client-side
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
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { walletAddress, sellToken, buyToken, sellAmount, slippagePct, dex } = body

    const sellUnit = TOKEN_UNITS[sellToken]
    const buyUnit = TOKEN_UNITS[buyToken]

    if (!sellUnit || !buyUnit) {
      return NextResponse.json({ error: `Unknown token: ${sellToken} or ${buyToken}` }, { status: 400 })
    }

    // Try DexHunter
    try {
      const dexHunterBody = {
        buyer_address: walletAddress,
        token_in: sellUnit === 'lovelace' ? '' : sellUnit,
        token_out: buyUnit === 'lovelace' ? '' : buyUnit,
        amount_in: parseInt(sellAmount.toString()),
        slippage: slippagePct,
        blacklisted_dexes: [],
      }

      const dexHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (DEXHUNTER_PARTNER_KEY) dexHeaders['X-Partner-Id'] = DEXHUNTER_PARTNER_KEY

      const resp = await fetch(`${DEXHUNTER_API}/swap/build`, {
        method: 'POST',
        headers: dexHeaders,
        body: JSON.stringify(dexHunterBody),
      })

      if (resp.ok) {
        const data = await resp.json()
        const txCbor = data.cbor || data.tx || data.transaction
        if (txCbor) {
          return NextResponse.json({
            success: true,
            txCbor,
            estimatedOutput: data.estimated_output || data.estimatedOutput,
            priceImpact: data.price_impact || data.priceImpact,
            source: 'dexhunter',
          })
        }
      }
    } catch (e) {
      console.warn('[swap/build] DexHunter error:', e)
    }

    // Try MuesliSwap aggregator
    try {
      // Parse policyId/assetName from unit
      function parseUnit(unit: string): { policyId: string; assetName: string } {
        if (unit === 'lovelace') return { policyId: '', assetName: '' }
        return { policyId: unit.slice(0, 56), assetName: unit.slice(56) }
      }

      const sellParsed = parseUnit(sellUnit)
      const buyParsed = parseUnit(buyUnit)

      const muesliResp = await fetch(`${MUESLI_API}/v1/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          sell: { ...sellParsed, amount: sellAmount.toString() },
          buy: buyParsed,
          slippage: slippagePct / 100,
          ...(dex ? { dex: dex.toLowerCase() } : {}),
        }),
      })

      if (muesliResp.ok) {
        const data = await muesliResp.json()
        const txCbor = data.cbor || data.tx || data.transaction
        if (txCbor) {
          return NextResponse.json({
            success: true,
            txCbor,
            estimatedOutput: data.estimatedOutput,
            source: 'muesliswap',
          })
        }
      }
    } catch (e) {
      console.warn('[swap/build] MuesliSwap error:', e)
    }

    return NextResponse.json({
      success: false,
      error: 'All swap aggregators unavailable',
      source: 'none',
    }, { status: 502 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
