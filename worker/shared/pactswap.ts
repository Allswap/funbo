const PACT_SWAP_API = 'https://api.pactswap.io';

export const PACT_SWAP_CHAIN_TYPES: Record<number, string> = {
  1: 'eth',
  137: 'pol',
  56: 'bnb',
  42161: 'arb',
  10: 'opt',
  8453: 'base',
  43114: 'avax',
  250: 'ftm',
};

export function getPactSwapTokenType(chainId: number, symbolOrAddress: string): string | null {
  const chainType = PACT_SWAP_CHAIN_TYPES[chainId];
  if (!chainType) return null;
  const s = symbolOrAddress.toLowerCase();
  if (s === 'eth' || s === 'weth') return 'eth';
  if (s === 'matic' || s === 'wmatic' || s === 'pol') return 'pol';
  if (s === 'bnb' || s === 'wbnb') return 'bnb';
  if (s === 'avax' || s === 'wavax') return 'avax';
  if (s === 'ftm' || s === 'wftm') return 'ftm';
  return `${s}_${chainType}`;
}

export interface PactSwapQuote {
  amountTo: number;
  amountFrom: number;
  lp: string;
  usdAmounts: { from: number; to: number };
}

export async function getSwapQuote(
  fromType: string,
  toType: string,
  amountFrom: number,
): Promise<PactSwapQuote | null> {
  try {
    const url = `${PACT_SWAP_API}/pactswap_cm/getSwapQuotesByAmountFrom`
      + `?fromType=${encodeURIComponent(fromType)}`
      + `&toType=${encodeURIComponent(toType)}`
      + `&amountFrom=${amountFrom}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

export async function getSwapQuoteByAmountTo(
  fromType: string,
  toType: string,
  amountTo: number,
): Promise<{ amountFrom: number; lp: string; usdAmounts: { from: number; to: number } } | null> {
  try {
    const url = `${PACT_SWAP_API}/pactswap_cm/getSwapQuotesByAmountTo`
      + `?fromType=${encodeURIComponent(fromType)}`
      + `&toType=${encodeURIComponent(toType)}`
      + `&amountTo=${amountTo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

export interface PactSwapComposeResult {
  rawTx: string;
  chainId?: number;
  value?: string;
  to?: string;
  type?: string;
}

export async function composeSwapTx(
  fromType: string,
  toType: string,
  toWalletAddress: string,
  fromWalletAddress: string,
  fromC1ContractId: string,
  fromC2ContractId: string,
  toC1ContractId: string,
  toC2ContractId: string,
  amountTo: number,
  lp?: string,
): Promise<PactSwapComposeResult | null> {
  try {
    let url = `${PACT_SWAP_API}/pactswap_cm/composeSwapTxByAmountTo`
      + `?fromType=${encodeURIComponent(fromType)}`
      + `&toType=${encodeURIComponent(toType)}`
      + `&toWalletAddress=${encodeURIComponent(toWalletAddress)}`
      + `&fromWalletAddress=${encodeURIComponent(fromWalletAddress)}`
      + `&fromC1ContractId=${encodeURIComponent(fromC1ContractId)}`
      + `&fromC2ContractId=${encodeURIComponent(fromC2ContractId)}`
      + `&toC1ContractId=${encodeURIComponent(toC1ContractId)}`
      + `&toC2ContractId=${encodeURIComponent(toC2ContractId)}`
      + `&amountTo=${amountTo}`;
    if (lp) url += `&lp=${encodeURIComponent(lp)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const STABLECOIN_SYMBOLS = ['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'LUSD'];
