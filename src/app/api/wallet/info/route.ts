import { NextResponse } from 'next/server'

/**
 * GET /api/wallet/info
 * Returns hot wallet address and balance from server-side seed phrase.
 * Never exposes the seed phrase.
 */

const BLOCKFROST_URL = 'https://cardano-mainnet.blockfrost.io/api/v0'
const BLOCKFROST_KEY = process.env.BLOCKFROST_API_KEY || ''

export async function GET() {
  try {
    const seedPhrase = process.env.CARDANO_SEED_PHRASE
    if (!seedPhrase) {
      return NextResponse.json({
        configured: false,
        error: 'Server wallet not configured',
      })
    }

    if (!BLOCKFROST_KEY) {
      return NextResponse.json({
        configured: false,
        error: 'Blockfrost API key not configured',
      })
    }

    const { Lucid, Blockfrost } = await import('lucid-cardano')
    const lucid = await Lucid.new(
      new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY),
      'Mainnet'
    )
    lucid.selectWalletFromSeed(seedPhrase)
    const address = await lucid.wallet.address()

    // Fetch balance from Blockfrost
    let balanceAda = 0
    try {
      const resp = await fetch(`${BLOCKFROST_URL}/addresses/${address}`, {
        headers: { project_id: BLOCKFROST_KEY },
      })
      if (resp.ok) {
        const data = await resp.json()
        const lovelace = data.amount?.find((a: { unit: string; quantity: string }) => a.unit === 'lovelace')
        balanceAda = lovelace ? parseInt(lovelace.quantity) / 1_000_000 : 0
      }
    } catch {}

    return NextResponse.json({
      configured: true,
      address,
      addressTruncated: address.slice(0, 12) + '...' + address.slice(-8),
      balanceAda,
      autoSign: true,
    })
  } catch (e) {
    return NextResponse.json({
      configured: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 })
  }
}
