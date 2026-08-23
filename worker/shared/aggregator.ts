/**
 * Aggregator helper — KyberSwap only for BRT fee-token.
 * BRT 0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b has 8% reflection fee (2+2+3+1)
 * Direct V2 getAmountsOut 0xd06ca61f reverts (tenderly/pol.leorpc execution reverted)
 * Kyber simulates fee correctly: 100 BRT -> 7782133804297 WPOL verified.
 * Use for BRT only; other tokens use normal rawQuoteRoute.
 */

export const BRT_ADDRESS = '0xeCb4cAc0C9e5cBd42a9Ed36467ce8f96072AD58b'.toLowerCase();
export const WPOL_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'.toLowerCase();
export const KYBER_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'.toLowerCase();
export const KYBER_API = 'https://aggregator-api.kyberswap.com/polygon/api/v1/routes';
export const FEE_TOKENS = new Set([BRT_ADDRESS]);

export function isFeeToken(addr: string): boolean {
  return FEE_TOKENS.has(addr.toLowerCase());
}

// Kyber quote: amountIn as decimal string (wei), returns amountOut bigint | null
export async function getKyberQuote(
  tokenIn: string,
  tokenOut: string,
  amountInWei: bigint,
  chainId: number = 137
): Promise<{ amountOut: bigint; routeId?: string; routerAddress: string } | null> {
  try {
    const url = `${KYBER_API}?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountInWei.toString()}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const summary = json?.data?.routeSummary;
    if (!summary?.amountOut) return null;
    const amountOut = BigInt(summary.amountOut);
    if (amountOut === 0n) return null;
    return { amountOut, routeId: summary.routeID, routerAddress: json?.data?.routerAddress || KYBER_ROUTER };
  } catch { return null; }
}

// Build Kyber swap calldata: POST /v1/route/encode with slippage
export async function buildKyberSwapData(
  tokenIn: string,
  tokenOut: string,
  amountInWei: bigint,
  slippagePct: number,
  recipient: string
): Promise<{ data: string; router: string } | null> {
  try {
    const url = 'https://aggregator-api.kyberswap.com/polygon/api/v1/route/encode';
    const body = JSON.stringify({
      tokenIn, tokenOut, amountIn: amountInWei.toString(),
      to: recipient, slippageTolerance: Math.round(slippagePct * 100), // 0.5% -> 50 bps
    });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (!json?.data?.data) return null;
    return { data: json.data.data, router: json.data.routerAddress || KYBER_ROUTER };
  } catch { return null; }
}

// Unified quote helper: BRT -> use Kyber, else use rawQuoteRouteAmount
export async function quoteWithAggregator(
  rpcUrl: string,
  tokenA: string,
  tokenB: string,
  router: any,
  feeTier: number,
  amountIn: bigint,
  env?: any,
  chainId?: number
): Promise<bigint | null> {
  if (isFeeToken(tokenA) || isFeeToken(tokenB)) {
    const kyber = await getKyberQuote(tokenA, tokenB, amountIn, chainId || 137);
    if (kyber) return kyber.amountOut;
  }
  // fallback to normal V2/V3 quoter (import lazily to avoid cycle)
  const { rawQuoteRouteAmount } = await import('./quotes');
  return rawQuoteRouteAmount(rpcUrl, tokenA, tokenB, router, feeTier, amountIn, env);
}
