import { NextRequest, NextResponse } from 'next/server'
import { ExecuteRequest, ExecuteResponse, ExecutionPlan, ExecutionStep } from '@/lib/types'
import { DEX_FEES, TX_FEE_ADA, DEX_SWAP_URLS } from '@/lib/constants'
import { fetchAllPrices } from '@/lib/dex-fetchers'

export async function POST(req: NextRequest) {
  try {
    const body: ExecuteRequest = await req.json()
    const { pair, buyDex, sellDex, amount, slippage } = body

    if (!pair || !buyDex || !sellDex || !amount) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 })
    }

    // Fetch current prices
    const { prices } = await fetchAllPrices()
    const [tokenA, tokenB] = pair.split('/')

    const buyPrice = prices.find(p => p.pair === pair && p.dex === buyDex)?.price
    const sellPrice = prices.find(p => p.pair === pair && p.dex === sellDex)?.price

    if (!buyPrice || !sellPrice) {
      return NextResponse.json({ success: false, message: 'Price data unavailable for this pair/DEX combo' }, { status: 404 })
    }

    const tokensAcquired = amount / buyPrice
    const grossReturn = tokensAcquired * sellPrice
    const buyFee = amount * (DEX_FEES[buyDex] || 0.003)
    const sellFee = grossReturn * (DEX_FEES[sellDex] || 0.003)
    const totalTxFee = TX_FEE_ADA * 2
    const netProfit = grossReturn - amount - buyFee - sellFee - totalTxFee
    const spreadPct = ((sellPrice - buyPrice) / buyPrice) * 100

    const steps: ExecutionStep[] = [
      {
        step: 1,
        action: `Swap ${amount.toFixed(2)} ADA → ${tokensAcquired.toFixed(2)} ${tokenB}`,
        details: `on ${buyDex} at ${buyPrice.toFixed(8)} ADA/${tokenB} (max slippage: ${slippage}%)`,
        estimatedFee: buyFee + TX_FEE_ADA,
      },
      {
        step: 2,
        action: `Swap ${tokensAcquired.toFixed(2)} ${tokenB} → ${grossReturn.toFixed(2)} ADA`,
        details: `on ${sellDex} at ${sellPrice.toFixed(8)} ADA/${tokenB} (max slippage: ${slippage}%)`,
        estimatedFee: sellFee + TX_FEE_ADA,
      },
      {
        step: 3,
        action: `Net profit: ${netProfit > 0 ? '+' : ''}${netProfit.toFixed(4)} ADA`,
        details: `after ${buyFee.toFixed(4)} + ${sellFee.toFixed(4)} DEX fees + ${totalTxFee.toFixed(2)} tx fees`,
        estimatedFee: 0,
      },
    ]

    const plan: ExecutionPlan = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pair,
      tokenA,
      tokenB,
      buyDex,
      sellDex,
      buyPrice,
      sellPrice,
      spreadPct,
      amount,
      slippage,
      steps,
      estimatedProfit: grossReturn - amount,
      netProfit,
      requiredCapital: amount,
      timeSensitivity: 'This opportunity may disappear in ~20s',
      buyDexUrl: DEX_SWAP_URLS[buyDex] || '#',
      sellDexUrl: DEX_SWAP_URLS[sellDex] || '#',
    }

    // ─── WALLET INTEGRATION PLACEHOLDER ───
    // When Lucid.js is integrated, this is where transaction building goes:
    //
    // import { Lucid, Blockfrost } from 'lucid-cardano'
    //
    // const lucid = await Lucid.new(
    //   new Blockfrost('https://cardano-mainnet.blockfrost.io/api/v0', BLOCKFROST_KEY),
    //   'Mainnet'
    // )
    // lucid.selectWallet(walletApi)
    //
    // Step 1: Build swap tx on buyDex
    // const buyTx = await lucid.newTx()
    //   .payToContract(buyDexAddress, { inline: buyDatum }, { lovelace: BigInt(amount * 1_000_000) })
    //   .complete()
    // const signedBuy = await buyTx.sign().complete()
    // const buyTxHash = await signedBuy.submit()
    //
    // Step 2: Wait for confirmation, build sell tx on sellDex
    // await lucid.awaitTx(buyTxHash)
    // const sellTx = ...
    //
    // Note: EUTXO means each UTxO consumed once per block.
    // For atomic arb, consider using a smart contract that batches both swaps.
    // ─────────────────────────────────────

    const response: ExecuteResponse = {
      success: true,
      plan,
      message: 'Execution plan generated. Wallet connection required to submit transactions.',
    }

    return NextResponse.json(response)
  } catch (e) {
    return NextResponse.json(
      { success: false, message: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}
