import { NextRequest, NextResponse } from 'next/server'

const BLOCKFROST_URL = 'https://cardano-mainnet.blockfrost.io/api/v0'
const BLOCKFROST_KEY = process.env.BLOCKFROST_API_KEY || ''

export async function POST(req: NextRequest) {
  try {
    const { signedTx } = await req.json()

    if (!signedTx) {
      return NextResponse.json({ error: 'Missing signedTx' }, { status: 400 })
    }

    if (!BLOCKFROST_KEY) {
      return NextResponse.json({
        error: 'BLOCKFROST_API_KEY not configured',
        mock: true,
      }, { status: 500 })
    }

    // Convert hex to binary for Blockfrost
    const bytes = new Uint8Array(signedTx.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(signedTx.substr(i * 2, 2), 16)
    }

    const resp = await fetch(`${BLOCKFROST_URL}/tx/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/cbor',
        'project_id': BLOCKFROST_KEY,
      },
      body: bytes.buffer,
    })

    if (resp.ok) {
      const txHash = (await resp.text()).replace(/"/g, '')
      return NextResponse.json({ success: true, txHash })
    }

    const errText = await resp.text()
    return NextResponse.json({ success: false, error: `Blockfrost: ${errText}` }, { status: 400 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
