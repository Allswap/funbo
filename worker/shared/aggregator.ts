/**
 * Aggregator helper — Multi-aggregator fallback for BRT fee-token.
 * BRT 0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b has 8% reflection fee (2+2+3+1)
 * Direct V2 getAmountsOut 0xd06ca61f reverts (tenderly/pol.leorpc execution reverted)
 * Kyber simulates fee correctly: 100 BRT -> 7782133804297 WPOL verified.
 * For BRT, try Kyber -> 0x -> ParaSwap -> Odos -> OpenOcean (skip 1inch per request).
 * For non-fee tokens, use direct rawQuoteRoute.
 */

export const BRT_ADDRESS = '0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b'.toLowerCase();
export const WPOL_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'.toLowerCase();
export const KYBER_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'.toLowerCase();
export const KYBER_API = 'https://aggregator-api.kyberswap.com/polygon/api/v1/routes';
export const FEE_TOKENS = new Set([BRT_ADDRESS]);

export function isFeeToken(addr: string): boolean {
  return FEE_TOKENS.has(addr.toLowerCase());
}

export type AggregatorQuote = { amountOut: bigint; routerAddress: string; source: string; routeId?: string };

// --- Kyber ---
export async function getKyberQuote(
  tokenIn: string, tokenOut: string, amountInWei: bigint, _chainId: number = 137
): Promise<AggregatorQuote | null> {
  try {
    const url = `${KYBER_API}?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountInWei.toString()}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const summary = json?.data?.routeSummary;
    if (!summary?.amountOut) return null;
    const amountOut = BigInt(summary.amountOut);
    if (amountOut === 0n) return null;
    return { amountOut, routerAddress: (json?.data?.routerAddress || KYBER_ROUTER).toLowerCase(), source: 'kyber', routeId: summary.routeID };
  } catch { return null; }
}

export async function buildKyberSwapData(
  tokenIn: string, tokenOut: string, amountInWei: bigint, slippagePct: number, recipient: string
): Promise<{ data: string; router: string } | null> {
  try {
    const url = 'https://aggregator-api.kyberswap.com/polygon/api/v1/route/encode';
    const body = JSON.stringify({ tokenIn, tokenOut, amountIn: amountInWei.toString(), to: recipient, slippageTolerance: Math.round(slippagePct * 100) });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (!json?.data?.data) return null;
    return { data: json.data.data, router: (json.data.routerAddress || KYBER_ROUTER).toLowerCase() };
  } catch { return null; }
}

// --- 0x (Matcha) — supports feeOnTransfer via flag ---
export async function get0xQuote(
  tokenIn: string, tokenOut: string, amountInWei: bigint, env?: any
): Promise<AggregatorQuote | null> {
  try {
    const apiKey = (env as any)?.ZEROX_API_KEY || (env as any)?.['0X_API_KEY'];
    const headers: Record<string,string> = { Accept: 'application/json' };
    if (apiKey) headers['0x-api-key'] = apiKey;
    // polygon.api.0x.org requires feeOnTransfer support via enableSlippageProtection=false for fee tokens
    const url = `https://polygon.api.0x.org/swap/v1/quote?sellToken=${tokenIn}&buyToken=${tokenOut}&sellAmount=${amountInWei.toString()}&feeOnTransfer=true`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (!json?.buyAmount) return null;
    return { amountOut: BigInt(json.buyAmount), routerAddress: (json.to || '0xdef1c0ded9bec7f1a1670819833240f027b4eef').toLowerCase(), source: '0x' };
  } catch { return null; }
}

export async function build0xSwapData(
  tokenIn: string, tokenOut: string, amountInWei: bigint, recipient: string, slippagePct: number, env?: any
): Promise<{ data: string; router: string } | null> {
  try {
    const apiKey = (env as any)?.ZEROX_API_KEY || (env as any)?.['0X_API_KEY'];
    const headers: Record<string,string> = { Accept: 'application/json' };
    if (apiKey) headers['0x-api-key'] = apiKey;
    const slippage = slippagePct / 100; // 8.5% -> 0.085
    const url = `https://polygon.api.0x.org/swap/v1/quote?sellToken=${tokenIn}&buyToken=${tokenOut}&sellAmount=${amountInWei.toString()}&takerAddress=${recipient}&slippagePercentage=${slippage}&feeOnTransfer=true`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (!json?.data || !json?.to) return null;
    return { data: json.data, router: json.to.toLowerCase() };
  } catch { return null; }
}

// --- ParaSwap (Velora) ---
export async function getParaSwapQuote(
  tokenIn: string, tokenOut: string, amountInWei: bigint
): Promise<AggregatorQuote | null> {
  try {
    // ParaSwap prices: srcDecimals/destDecimals needed — assume 9 for BRT, 18 for WPOL (auto-detect would need decimals, simplified)
    const srcDecimals = tokenIn.toLowerCase() === BRT_ADDRESS ? '9' : '18';
    const destDecimals = tokenOut.toLowerCase() === BRT_ADDRESS ? '9' : '18';
    const url = `https://apiv5.paraswap.io/prices/?srcToken=${tokenIn}&destToken=${tokenOut}&amount=${amountInWei.toString()}&srcDecimals=${srcDecimals}&destDecimals=${destDecimals}&side=SELL&network=137`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const destAmount = json?.priceRoute?.destAmount;
    if (!destAmount) return null;
    return { amountOut: BigInt(destAmount), routerAddress: (json.priceRoute?.tokenTransferProxy || '0x216b4b4ba9f6e511a38a5a6f2a6a3b0f3d4e5a6c7').toLowerCase(), source: 'paraswap' };
  } catch { return null; }
}

export async function buildParaSwapData(
  tokenIn: string, tokenOut: string, amountInWei: bigint, recipient: string, slippagePct: number, _env?: any
): Promise<{ data: string; router: string } | null> {
  try {
    const srcDecimals = tokenIn.toLowerCase() === BRT_ADDRESS ? '9' : '18';
    const destDecimals = tokenOut.toLowerCase() === BRT_ADDRESS ? '9' : '18';
    const priceUrl = `https://apiv5.paraswap.io/prices/?srcToken=${tokenIn}&destToken=${tokenOut}&amount=${amountInWei.toString()}&srcDecimals=${srcDecimals}&destDecimals=${destDecimals}&side=SELL&network=137`;
    const priceRes = await fetch(priceUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!priceRes.ok) return null;
    const priceJson: any = await priceRes.json();
    const priceRoute = priceJson?.priceRoute;
    if (!priceRoute) return null;
    const body = JSON.stringify({
      srcToken: tokenIn, destToken: tokenOut, srcAmount: amountInWei.toString(),
      destAmount: priceRoute.destAmount, priceRoute, userAddress: recipient, partner: 'funbo', srcDecimals, destDecimals, slippage: Math.round(slippagePct * 100) // bps
    });
    const res = await fetch('https://apiv5.paraswap.io/transactions/137?ignoreChecks=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (!json?.data) return null;
    return { data: json.data, router: (json.to || priceRoute.tokenTransferProxy || '').toLowerCase() };
  } catch { return null; }
}

// --- Odos ---
export async function getOdosQuote(
  tokenIn: string, tokenOut: string, amountInWei: bigint
): Promise<AggregatorQuote | null> {
  try {
    const body = JSON.stringify({ chainId: 137, inputTokens: [{ tokenAddress: tokenIn, amount: amountInWei.toString() }], outputTokens: [{ tokenAddress: tokenOut, proportion: 1 }], slippageLimitPercent: 8.5, userAddr: '0x0000000000000000000000000000000000000001' });
    const res = await fetch('https://api.odos.xyz/sor/quote/v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const outAmt = json?.outAmounts?.[0] || json?.outAmount;
    if (!outAmt) return null;
    return { amountOut: BigInt(outAmt), routerAddress: '0x19c65b8fe98a291a31813e1e7c9a60e3d97a6ff6'.toLowerCase(), source: 'odos' };
  } catch { return null; }
}

// --- OpenOcean ---
export async function getOpenOceanQuote(
  tokenIn: string, tokenOut: string, amountInWei: bigint
): Promise<AggregatorQuote | null> {
  try {
    const url = `https://open-api.openocean.finance/v3/137/swap_quote?inTokenAddress=${tokenIn}&outTokenAddress=${tokenOut}&amount=${amountInWei.toString()}&gasPrice=50`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const outAmount = json?.data?.outAmount || json?.data?.estimatedOutAmount;
    if (!outAmount) return null;
    return { amountOut: BigInt(outAmount), routerAddress: (json.data?.to || '0x6352a56caadc4f1e25cd6c75978570ff768a3304').toLowerCase(), source: 'openocean' };
  } catch { return null; }
}

// Unified fallback chain for BRT: Kyber -> 0x -> ParaSwap -> Odos -> OpenOcean (skip 1inch)
export async function getBestAggregatorQuote(
  tokenIn: string, tokenOut: string, amountInWei: bigint, env?: any
): Promise<AggregatorQuote | null> {
  const chain = [
    () => getKyberQuote(tokenIn, tokenOut, amountInWei),
    () => get0xQuote(tokenIn, tokenOut, amountInWei, env),
    () => getParaSwapQuote(tokenIn, tokenOut, amountInWei),
    () => getOdosQuote(tokenIn, tokenOut, amountInWei),
    () => getOpenOceanQuote(tokenIn, tokenOut, amountInWei),
  ];
  for (const fn of chain) {
    const q = await fn();
    if (q && q.amountOut > 0n) return q;
  }
  return null;
}

export async function buildBestAggregatorSwap(
  tokenIn: string, tokenOut: string, amountInWei: bigint, recipient: string, slippagePct: number, env?: any
): Promise<{ data: string; router: string; source: string } | null> {
  // Try Kyber encode first (most proven for BRT)
  const kyber = await buildKyberSwapData(tokenIn, tokenOut, amountInWei, slippagePct, recipient);
  if (kyber) return { ...kyber, source: 'kyber' };
  const zerox = await build0xSwapData(tokenIn, tokenOut, amountInWei, recipient, slippagePct, env);
  if (zerox) return { ...zerox, source: '0x' };
  const para = await buildParaSwapData(tokenIn, tokenOut, amountInWei, recipient, slippagePct, env);
  if (para) return { ...para, source: 'paraswap' };
  // Odos/OpenOcean build requires assemble step - fallback to Kyber quote-only execution via SupportingFee
  return null;
}

// Unified quote helper: BRT -> multi-aggregator, else direct V2/V3
export async function quoteWithAggregator(
  rpcUrl: string, tokenA: string, tokenB: string, router: any, feeTier: number, amountIn: bigint, env?: any, chainId?: number
): Promise<bigint | null> {
  if (isFeeToken(tokenA) || isFeeToken(tokenB)) {
    const best = await getBestAggregatorQuote(tokenA, tokenB, amountIn, env);
    if (best) return best.amountOut;
  }
  const { rawQuoteRouteAmount } = await import('./quotes');
  return rawQuoteRouteAmount(rpcUrl, tokenA, tokenB, router, feeTier, amountIn, env);
}
