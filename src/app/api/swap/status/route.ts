import { NextRequest, NextResponse } from 'next/server'

const BLOCKFROST_URL = 'https://cardano-mainnet.blockfrost.io/api/v0'
const BLOCKFROST_KEY = process.env.BLOCKFROST_API_KEY || ''

export async function POST(req: NextRequest) {
  try {
    const { txHash } = await req.json()

    if (!txHash || !BLOCKFROST_KEY) {
      return NextResponse.json({ confirmed: false })
    }

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
        slot: data.slot,
      })
    }

    return NextResponse.json({ confirmed: false })
  } catch {
    return NextResponse.json({ confirmed: false })
  }
}
