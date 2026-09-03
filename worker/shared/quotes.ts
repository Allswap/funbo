import { encodeV3Path, classifyProvider, recordUsage } from './rpc-pool';

export const V2_GET_AMOUNTS_OUT = '0xd06ca61f';
export const V3_QUOTE_EXACT_INPUT = '0xcdca1753';
export const ERC20_DECIMALS = '0x313ce567';

export const V3_FEE_TIERS = [1000, 3000, 500, 10000, 100];
export const DEFAULT_AMOUNT_IN = 100000000000000000n;

const decimalCache = new Map<string, number>();

function hexVal(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

function hexAddr(a: string): string {
  return a.toLowerCase().replace('0x', '').padStart(64, '0');
}

function hexBytes(data: string): string {
  const clean = data.replace('0x', '');
  return clean.padEnd(Math.ceil(clean.length / 64) * 64, '0');
}

function abiEncodeUint256AddressList(amountIn: bigint, tokens: string[]): string {
  const offset = '0000000000000000000000000000000000000000000000000000000000000040';
  const length = hexVal(BigInt(tokens.length));
  return hexVal(amountIn) + offset + length + tokens.map(t => hexAddr(t)).join('');
}

function abiEncodeBytesUint256(path: string, amountIn: bigint): string {
  const clean = path.replace('0x', '');
  const byteLen = BigInt(clean.length / 2);
  const padded = clean.padEnd(Math.ceil(clean.length / 64) * 64, '0');
  const offset = '0000000000000000000000000000000000000000000000000000000000000040';
  return offset + hexVal(amountIn) + hexVal(byteLen) + padded;
}

function abiDecodeUint256List(hex: string): bigint[] {
  const s = hex.replace('0x', '');
  const off = parseInt(s.slice(0, 64), 16) * 2;
  const len = parseInt(s.slice(off, off + 64), 16);
  const r: bigint[] = [];
  for (let i = 0; i < len; i++) {
    r.push(BigInt('0x' + s.slice(off + 64 + i * 64, off + 64 + (i + 1) * 64)));
  }
  return r;
}

function abiDecodeUint256(hex: string): bigint {
  return BigInt('0x' + hex.replace('0x', '').slice(0, 64));
}

export async function rawEthCall(rpcUrl: string, to: string, data: string, env?: any): Promise<string | null> {
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 });
    const res = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(3000) });
    const json = await res.json() as any;
    if (env) {
      const provider = classifyProvider(rpcUrl);
      if (provider) {
        recordUsage(env, provider, 'requests_per_minute').catch(() => {});
        recordUsage(env, provider, 'requests_per_day').catch(() => {});
      }
    }
    return json.result || null;
  } catch { return null; }
}

export function rawQuoteRoute(rpcUrl: string, tokenA: string, tokenB: string, router: any, feeTier: number, env?: any): Promise<bigint | null> {
  return rawQuoteRouteAmount(rpcUrl, tokenA, tokenB, router, feeTier, DEFAULT_AMOUNT_IN, env);
}

// Polyon native POL (0x1010) is not an ERC-20 path token — pools use wrapped WPOL.
function pathToken(addr: string): string {
  const a = addr.toLowerCase();
  return a === '0x0000000000000000000000000000000000001010' ? '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270' : a;
}

export async function rawQuoteRouteAmount(rpcUrl: string, tokenA: string, tokenB: string, router: any, feeTier: number, amountIn: bigint, env?: any): Promise<bigint | null> {
  try {
    const tA = pathToken(tokenA);
    const tB = pathToken(tokenB);
    const version = (router.version || 'v2').toLowerCase();
    if (version === 'v3') {
      const quoter = (router.quoter_address || '').trim();
      let bestOut: bigint | null = null;
      for (const ft of V3_FEE_TIERS) {
        const path = encodeV3Path([tA, tB], [ft]);
        const data = V3_QUOTE_EXACT_INPUT + abiEncodeBytesUint256(path, amountIn);
        const result = await rawEthCall(rpcUrl, quoter, data, env);
        if (result) {
          try {
            const amountOut = abiDecodeUint256(result);
            if (amountOut > 0n && (bestOut === null || amountOut > bestOut)) bestOut = amountOut;
          } catch {}
        }
      }
      return bestOut;
    }
    const data = V2_GET_AMOUNTS_OUT + abiEncodeUint256AddressList(amountIn, [tA, tB]);
    const result = await rawEthCall(rpcUrl, router.address, data, env);
    if (!result) return null;
    const decoded = abiDecodeUint256List(result);
    return decoded[1];
  } catch { return null; }
}

export async function getTokenDecimals(rpcUrl: string, token: string, chainId?: number, env?: any): Promise<number> {
  const key = chainId ? `${chainId}:${token.toLowerCase()}` : token.toLowerCase();
  const cached = decimalCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const result = await rawEthCall(rpcUrl, token, '0x313ce567', env);
    if (result) {
      const dec = parseInt(result, 16);
      decimalCache.set(key, dec);
      return dec;
    }
  } catch {}
  return 18;
}