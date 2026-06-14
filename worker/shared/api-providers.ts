import { callWithRateLimit, isRateLimitError } from './rate-limiter';

const WELL_KNOWN_TOKENS: Record<number, Set<string>> = {
  137: new Set([
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC/WPOL
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC (Native)
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC.e (Bridged)
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
    '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', // DAI
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
    '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', // WBTC
    '0xa3fa99a148fa48d14ed51d610c367c61876997f1', // miMATIC
    '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a', // SUSHI
    '0xb33eaad8d922b1083446dc23f610c2567fb5180f', // UNI
    '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39', // LINK
    '0xd6df932a45c0f255f85145f286ea0b292b21c90b', // AAVE
    '0x7fb688ccf682d58f86d7e38e03f9d22e7705448f', // CRV
    '0x0000000000000000000000000000000000001010', // MATIC (native)
  ]),
  80002: new Set([
    '0x9c3c9283d3e44854697cd22d3faa240cfb032889', // WMATIC Amoy
    '0x41e94eb019c0762f9bfcf9fb1e58725bfb0a7582', // USDC Amoy
  ]),
  1: new Set([
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE
    '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
  ]),
  42161: new Set([
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
  ]),
  10: new Set([
    '0x4200000000000000000000000000000000000006', // WETH
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85', // USDC
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', // USDT
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
  ]),
  8453: new Set([
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
  ]),
};

export function isWellKnownToken(tokenAddress: string, chainId: number): boolean {
  const addr = tokenAddress.toLowerCase();
  const tokens = WELL_KNOWN_TOKENS[chainId];
  return tokens ? tokens.has(addr) : false;
}

export async function isWellKnownTokenWithConfig<EnvT extends Record<string, any>>(
  tokenAddress: string,
  chainId: number,
  env?: EnvT
): Promise<boolean> {
  const addr = tokenAddress.toLowerCase();
  const hardcoded = WELL_KNOWN_TOKENS[chainId];
  if (hardcoded?.has(addr)) return true;
  if (env) {
    try {
      const db = env['funbo-db'];
      if (db) {
        const row = await db.prepare("SELECT value FROM config WHERE key = 'well_known_tokens'").first() as { value?: string } | null;
        if (row?.value) {
          const configTokens: Record<string, string[]> = JSON.parse(row.value);
          const chainTokens = configTokens[String(chainId)];
          if (chainTokens?.some(t => t.toLowerCase() === addr)) return true;
        }
      }
    } catch { /* ignore config read errors */ }
  }
  return false;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: string;
  icon_url: string | null;
  exchange_rate: string | null;
  circulating_market_cap: string | null;
  total_supply: string | null;
  holders: string;
  is_verified_contract: boolean | null;
}

export interface TxInfo {
  hash: string;
  from: { hash: string };
  to: { hash: string };
  value: string;
  fee: { value: string };
  status: 'ok' | 'error';
  block: number;
  timestamp: string;
  method: string | null;
  gas_used: string;
  gas_price: string;
}

export interface AddressInfo {
  hash: string;
  coin_balance: string;
  is_contract: boolean | null;
  is_verified: boolean | null;
  name: string | null;
  implementations: Array<{ address_hash: string; name: string | null }>;
}

export interface SafetyResult {
  safe: boolean;
  reason: string;
  details?: Record<string, any>;
}

export interface GeckoPool {
  name: string;
  address: string;
  token_addresses: string;
  base_token_symbol: string;
  quote_token_symbol: string;
}

const BS_BASES: Record<number, string> = {
  1: 'https://eth.blockscout.com',
  10: 'https://optimism.blockscout.com',
  137: 'https://polygon.blockscout.com',
  42161: 'https://arbitrum.blockscout.com',
  8453: 'https://base.blockscout.com',
  80002: 'https://amoy.polygonscan.com',
};

function pickBsBase(chainId: number): string {
  for (const [id, base] of Object.entries(BS_BASES)) {
    if (Number(id) === chainId) return base;
  }
  return `https://api.blockscout.com/${chainId}`;
}

export class BlockscoutClient {
  private baseUrl: string;
  private apiKey?: string;
  private chainId: number;

  constructor(explorerUrl: string, apiKey?: string, chainId?: number) {
    this.baseUrl = explorerUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.chainId = chainId || 0;
  }

  private async api(path: string, usePro = false): Promise<any | null> {
    return callWithRateLimit('blockscout', async () => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      let url: string;
      if (usePro && this.apiKey && this.chainId) {
        headers['authorization'] = `Bearer ${this.apiKey}`;
        url = `https://api.blockscout.com/${this.chainId}/api/v2${path}`;
      } else if (this.chainId && BS_BASES[this.chainId]) {
        url = `${pickBsBase(this.chainId)}/api/v2${path}`;
      } else {
        url = `${this.baseUrl}/api/v2${path}`;
      }
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }).catch((err) => {
      if (isRateLimitError(err)) return null;
      throw err;
    });
  }

  async getTokenInfo(address: string): Promise<TokenInfo | null> {
    const data = await this.api(`/tokens/${address}`, !!this.apiKey);
    if (!data) return null;
    return {
      address: data.address_hash || data.address || '',
      symbol: data.symbol || '',
      name: data.name || '',
      decimals: String(data.decimals || 18),
      icon_url: data.icon_url || null,
      exchange_rate: data.exchange_rate || null,
      circulating_market_cap: data.circulating_market_cap || null,
      total_supply: data.total_supply || null,
      holders: String(data.holders_count || 0),
      is_verified_contract: data.is_verified || null,
    };
  }

  async getTokenPrice(address: string): Promise<number | null> {
    const info = await this.getTokenInfo(address);
    if (!info?.exchange_rate) return null;
    const p = parseFloat(info.exchange_rate);
    return isNaN(p) ? null : p;
  }

  async isContractVerified(address: string): Promise<boolean | null> {
    const data = await this.api(`/addresses/${address}`, !!this.apiKey);
    return data?.is_verified ?? null;
  }

  async getAddressInfo(address: string): Promise<AddressInfo | null> {
    return await this.api(`/addresses/${address}`, !!this.apiKey) as AddressInfo | null;
  }

  async getTxDetails(txHash: string): Promise<TxInfo | null> {
    const data = await this.api(`/transactions/${txHash}`, !!this.apiKey);
    if (!data) return null;
    return {
      hash: data.hash || txHash,
      from: data.from || { hash: data.from_hash || '' },
      to: data.to || { hash: data.to_hash || '' },
      value: data.value || '0',
      fee: data.fee || { value: data.tx_fee || '0' },
      status: data.status || (data.success ? 'ok' : 'error'),
      block: Number(data.block || data.block_number || 0),
      timestamp: data.timestamp || '',
      method: data.method || null,
      gas_used: String(data.gas_used || data.gas || 0),
      gas_price: String(data.gas_price || 0),
    };
  }

  async getTokenHoldersCount(address: string): Promise<number | null> {
    const data = await this.api(`/tokens/${address}/token-holders`, !!this.apiKey) as { items?: any[] } | null;
    return data?.items?.length ?? null;
  }

  async getAccountBalance(address: string): Promise<string | null> {
    const data = await this.api(`/addresses/${address}`, !!this.apiKey) as AddressInfo | null;
    return data?.coin_balance ?? null;
  }

  async getChainStats(): Promise<{ total_blocks: string; total_transactions: string; average_block_time: number; coin_price: string | null } | null> {
    return await this.api('/stats') as any;
  }

  async getAddressTransactions(address: string, limit = 50): Promise<any[] | null> {
    const data = await this.api(`/addresses/${address}/transactions?limit=${limit}`, !!this.apiKey) as { items?: any[] } | null;
    return data?.items ?? null;
  }

  async getTokenHolders(address: string, limit = 50): Promise<any[] | null> {
    const data = await this.api(`/tokens/${address}/token-holders?limit=${limit}`, !!this.apiKey) as { items?: any[] } | null;
    return data?.items ?? null;
  }

  async validatePrice(tokenA: string, tokenB: string, dexPrice: number, maxDeviationPct: number): Promise<{ valid: boolean; reason: string }> {
    const marketPrices = await Promise.all([this.getTokenPrice(tokenA), this.getTokenPrice(tokenB)]);
    for (let i = 0; i < marketPrices.length; i++) {
      const market = marketPrices[i];
      const addr = i === 0 ? tokenA : tokenB;
      if (market === null || market <= 0 || dexPrice <= 0) continue;
      const deviation = Math.abs(market - dexPrice) / market * 100;
      if (deviation > maxDeviationPct) {
        return { valid: false, reason: `Token ${addr.slice(0, 6)} deviates ${deviation.toFixed(1)}% from market (market $${market}, dex $${dexPrice.toFixed(2)})` };
      }
    }
    return { valid: true, reason: 'Price within range' };
  }
}

export async function goplusScanTokenSafety(env: Env, tokenAddress: string, chainId: number): Promise<SafetyResult> {
  const addrLower = tokenAddress.toLowerCase();

  if (isWellKnownToken(tokenAddress, chainId)) {
    return { safe: true, reason: `Well-known token`, details: { whitelisted: true } };
  }

  const apiKey = env.GOPLUS_API_KEY;
  if (!apiKey) {
    return { safe: true, reason: 'No GoPlus key - scan skipped', details: { skipped: true } };
  }

  try {
    const data: any = await callWithRateLimit('goplus', async () => {
      const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;
      const res = await fetch(url, { headers: { 'X-GoPlus-Token': apiKey } });
      if (!res.ok) throw Object.assign(new Error(`GoPlus ${res.status}`), { status: res.status });
      return res.json();
    });
    if (!data.result || !data.result[addrLower]) {
      const keys = data.result ? Object.keys(data.result).join(',') : 'null';
      console.log(`[GoPlus] Not found for ${tokenAddress} (lower=${addrLower}). result_keys=${keys.slice(0, 200)}`);
      return { safe: false, reason: 'Not found on GoPlus', details: data };
    }
    const t = data.result[addrLower];

    if (t.is_honeypot === '1') return { safe: false, reason: 'Honeypot', details: t };
    if (t.is_blacklisted === '1') return { safe: false, reason: 'Blacklist', details: t };
    const buyTax = parseFloat(t.buy_tax || '0');
    const sellTax = parseFloat(t.sell_tax || '0');
    if ((!isNaN(buyTax) && buyTax > 10) || (!isNaN(sellTax) && sellTax > 10)) {
      return { safe: false, reason: `High tax buy ${t.buy_tax}% sell ${t.sell_tax}%`, details: t };
    }
    if (t.is_open_source !== '1') return { safe: false, reason: 'Not open source', details: t };
    return { safe: true, reason: 'OK', details: t };
  } catch (err: any) {
    return { safe: false, reason: `Scan failed: ${err.message}`, details: { error: err.message } };
  }
}

export interface TradeHistoryResult {
  safe: boolean;
  reason: string;
  details?: { holders?: number; txs?: number; verified?: boolean | null };
}

export async function checkTokenTradeHistory(
  explorerUrl: string,
  apiKey: string | undefined,
  chainId: number,
  tokenAddress: string,
  minHolders = 10,
  minTxs = 5,
): Promise<TradeHistoryResult> {
  try {
    const bs = new BlockscoutClient(explorerUrl, apiKey, chainId);
    const [info, txs] = await Promise.all([
      bs.getTokenInfo(tokenAddress),
      bs.getAddressTransactions(tokenAddress, 50),
    ]);
    const holders = info?.holders ? parseInt(info.holders) : 0;
    const txCount = txs?.length ?? 0;
    const verified = info?.is_verified_contract ?? null;

    if (info === null) {
      return { safe: false, reason: 'Token not found on explorer', details: { holders: 0, txs: 0, verified: null } };
    }
    if (holders < minHolders) {
      return { safe: false, reason: `Only ${holders} holders (min ${minHolders})`, details: { holders, txs: txCount, verified } };
    }
    if (txCount < minTxs) {
      return { safe: false, reason: `Only ${txCount} transactions (min ${minTxs})`, details: { holders, txs: txCount, verified } };
    }
    return { safe: true, reason: `OK (${holders} holders, ${txCount} txs)`, details: { holders, txs: txCount, verified } };
  } catch (err: any) {
    return { safe: false, reason: `History check failed: ${err.message}`, details: undefined };
  }
}

const DEXSCREENER_SLUGS: Record<number, string> = {
  1: 'ethereum', 10: 'optimism', 137: 'polygon', 42161: 'arbitrum', 8453: 'base', 43114: 'avalanche', 56: 'bsc', 250: 'fantom', 80002: 'polygon', 84532: 'base',
};

export async function dexscreenerGetPools(chainId: number, apiUrl: string): Promise<{ tokenA: string; tokenB: string; label?: string; dexLabel?: string }[]> {
  const slug = DEXSCREENER_SLUGS[chainId] || String(chainId);
  try {
    const url = `${apiUrl}/latest/dex/search?q=${slug}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data?.pairs ?? []).slice(0, 10).map((pair: any) => {
      const a = pair?.tokenAddress;
      const b = pair?.quoteTokenAddress;
      if (a && b && a !== b) return { tokenA: a, tokenB: b, label: pair?.baseToken?.symbol || '', dexLabel: pair?.dexId || '' };
      return null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export async function geckoGetTrendingPools(chainId = 137, limit = 50): Promise<GeckoPool[]> {
  const chainMap: Record<number, string> = {
    1: 'eth', 10: 'optimism', 137: 'polygon', 42161: 'arbitrum', 8453: 'base',
  };
  const slug = chainMap[chainId] || 'polygon';
  const url = `https://api.geckoterminal.com/api/v2/networks/${slug}/trending_pools?limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Gecko ${res.status}`);
  const data: any = await res.json();
  return (data.data || []).map((p: any) => {
    return {
      name: p.attributes?.name || '',
      address: p.attributes?.address || '',
      token_addresses: p.attributes?.token_addresses || '',
      base_token_symbol: p.attributes?.base_token_symbol || '',
      quote_token_symbol: p.attributes?.quote_token_symbol || '',
    };
  });
}

export async function telegramSend(env: Env, chatId: string, text: string): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface RpcCallResult<T> {
  data: T | null;
  provider: string;
  latencyMs: number;
  usedFallback: boolean;
}

export async function rpcCall<T>(
  env: Env,
  chainId: number,
  method: string,
  params: any[] = [],
  opts?: { provider?: string; timeoutMs?: number }
): Promise<RpcCallResult<T>> {
  const { getHealthyRpcPool } = await import('./rpc-pool');
  const pool = await getHealthyRpcPool(env, chainId, opts?.provider);
  const timeout = opts?.timeoutMs || 4000;

  const errors: string[] = [];
  for (const url of pool) {
    if (url.includes('blockscout') && !url.includes('rpc')) continue;
    const start = Date.now();
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'EVM-Bot/2.0' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: controller.signal,
      });
      clearTimeout(tid);
      const ms = Date.now() - start;
      if (res.status === 403) {
        errors.push(`${url}: 403`);
        continue;
      }
      if (!res.ok) {
        errors.push(`${url}: ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { result?: T; error?: any };
      if (json.error) {
        errors.push(`${url}: ${json.error.message || JSON.stringify(json.error)}`);
        continue;
      }
      const providerName = url.includes('publicnode') ? 'publicnode'
        : url.includes('moralis.io') ? 'moralis'
        : url.includes('drpc.org') ? 'drpc'
        : url.includes('ankr') ? 'ankr'
        : url.includes('nownodes') ? 'nownodes'
        : url.includes('getblock') ? 'getblock'
        : url.includes('1rpc') ? '1rpc'
        : url;
      return { data: json.result ?? null, provider: providerName, latencyMs: ms, usedFallback: false };
    } catch (e: any) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  return { data: null, provider: 'fallback-failed', latencyMs: 0, usedFallback: true };
}

export async function ankrGetAccountBalance(env: Env, chainId: number, address: string): Promise<string | null> {
  const apiKey = env.ANKR_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.ankr.com/v1/account/${address}?network=${chainId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.balance ?? null;
  } catch {
    return null;
  }
}

export async function ankrGetTokenInfo(env: Env, chainId: number, address: string): Promise<any | null> {
  const apiKey = env.ANKR_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.ankr.com/v1/contracts/${address}/tokens?network=${chainId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function ankrGetNFTs(env: Env, chainId: number, owner: string): Promise<any | null> {
  const apiKey = env.ANKR_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.ankr.com/v1/chain/${chainId}/account/${owner}/nfts`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function ankrQueryAssets(env: Env, chainId: number, owner: string): Promise<any | null> {
  const apiKey = env.ANKR_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.ankr.com/v1/chain/${chainId}/account/${owner}/assets`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.assets ?? null;
  } catch {
    return null;
  }
}

export async function ankrQueryTransactions(env: Env, chainId: number, address: string, limit = 50): Promise<any | null> {
  const apiKey = env.ANKR_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.ankr.com/v1/chain/${chainId}/account/${address}/txs?limit=${limit}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function drpcGetUsage(env: Env): Promise<any | null> {
  const apiKey = env.DRPC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.drpc.org/v1/usage?key=${apiKey}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function drpcGetStats(env: Env): Promise<any | null> {
  const apiKey = env.DRPC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.drpc.org/v1/stats?key=${apiKey}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function drpcGetEndpoints(env: Env): Promise<any | null> {
  const apiKey = env.DRPC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.drpc.org/v1/endpoints?key=${apiKey}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function drpcWeb3Snapshot(env: Env, chainId: number, blockNumber?: number): Promise<any | null> {
  const apiKey = env.DRPC_API_KEY;
  if (!apiKey) return null;
  try {
    const url = blockNumber
      ? `https://api.drpc.org/v1/web3snapshot/chain/${chainId}/block/${blockNumber}?key=${apiKey}`
      : `https://api.drpc.org/v1/web3snapshot/chain/${chainId}?key=${apiKey}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function drpcMEVProtectEstimate(env: Env, chainId: number, txData: any): Promise<any | null> {
  const apiKey = env.DRPC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.drpc.org/v1/mevprotect/estimate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ chainId, ...txData }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function llamaSwapQuote(
  env: Env,
  chainId: number,
  sellToken: string,
  buyToken: string,
  amount: string
): Promise<any | null> {
  try {
    const url = `https://swap.defillama.com/api/quote?chainId=${chainId}&sellToken=${sellToken}&buyToken=${buyToken}&amount=${amount}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function llamaGetYields(chainId?: number, protocol?: string): Promise<any | null> {
  try {
    const base = 'https://yields.llama.fi/yields';
    const params = new URLSearchParams();
    if (chainId) params.append('chain', String(chainId));
    if (protocol) params.append('protocol', protocol);
    const res = await fetch(`${base}?${params.toString()}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function llamaGetTokens(chainId: number, address?: string): Promise<any | null> {
  try {
    const base = 'https://coins.llama.fi/basicPrices';
    const params = new URLSearchParams();
    if (chainId) params.append('chain', String(chainId));
    if (address) params.append('tokens', address);
    const res = await fetch(`${base}?${params.toString()}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function llamaGetTVL(protocol: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.llama.fi/protocol/${protocol}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function llamaGetChainTVL(chainId: number): Promise<any | null> {
  try {
    const res = await fetch(`https://api.llama.fi/v2/chains`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.find((c: any) => c.chainId === chainId) ?? null;
  } catch {
    return null;
  }
}

export async function nownodesGetPrices(env: Env, symbols: string[]): Promise<Record<string, number> | null> {
  const apiKey = env.NOWNODES_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.nownodes.io/v1/price?symbols=${symbols.join(',')}`, {
      headers: { 'Authorization': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.data ?? null;
  } catch {
    return null;
  }
}

export async function nownodesGetFiatRates(env: Env, currency = 'usd'): Promise<any | null> {
  const apiKey = env.NOWNODES_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://fiat-rates.nownodes.io/v1/rates?currency=${currency}`, {
      headers: { 'Authorization': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function goplusBatchTokenSafety(
  env: Env,
  chainId: number,
  addresses: string[]
): Promise<Map<string, SafetyResult>> {
  const results = new Map<string, SafetyResult>();

  // Pre-mark well-known tokens as safe without calling GoPlus
  const unknown: string[] = [];
  for (const addr of addresses) {
    if (isWellKnownToken(addr, chainId)) {
      results.set(addr.toLowerCase(), { safe: true, reason: 'Well-known token', details: { whitelisted: true } });
    } else {
      unknown.push(addr);
    }
  }
  if (unknown.length === 0) return results;

  const apiKey = env.GOPLUS_API_KEY;
  if (!apiKey) {
    for (const addr of unknown) results.set(addr.toLowerCase(), { safe: true, reason: 'No GoPlus key - scan skipped', details: { skipped: true } });
    return results;
  }

  const chunkSize = 20;
  for (let i = 0; i < unknown.length; i += chunkSize) {
    const chunk = unknown.slice(i, i + chunkSize).join(',');
    try {
      const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${chunk}`;
      const res = await fetch(url, { headers: { 'X-GoPlus-Token': apiKey } });
      if (!res.ok) continue;
      const data: any = await res.json();
      if (!data.result) continue;
      for (const [addr, info] of Object.entries(data.result as Record<string, any>)) {
        const t = info as any;
        const safe = t.is_honeypot !== '1'
          && t.is_blacklisted !== '1'
          && parseFloat(t.buy_tax || '0') <= 10
          && parseFloat(t.sell_tax || '0') <= 10
          && t.is_open_source === '1';
        results.set(addr, { safe, reason: safe ? 'OK' : `Honeypot:${t.is_honeypot} Tax:${t.buy_tax}/${t.sell_tax} Open:${t.is_open_source}`, details: t });
      }
    } catch {}
  }
  return results;
}

const MORALIS_BASE_URL = "https://deep-index.moralis.io/api/v2";

interface MoralisChainIds {
  [key: string]: string;
}

const MORALIS_CHAIN_IDS: MoralisChainIds = {
  "1": "eth",
  "10": "optimism",
  "137": "polygon",
  "42161": "arbitrum",
  "8453": "base",
  "43114": "avalanche",
  "56": "bsc",
  "146": "sonic",
  "250": "fantom",
  "324": "zksync",
  "84532": "base-sepolia",
  "11155111": "blast",
  "534352": "scroll",
  "81457": "blast",
  "42220": "celo",
};

function getMoralisChain(chainId: number): string | null {
  return MORALIS_CHAIN_IDS[chainId.toString()] || null;
}

interface MoralisTokenInfo {
  address: string;
  name: string;
  symbol: string;
  logo: string;
  thumbnail: string;
  decimals: string | number;
  total_supply: string;
  owners_count: string;
  market_cap: string;
}

interface MoralisPairInfo {
  pairAddress: string;
  dexId: string;
  baseToken: MoralisTokenInfo;
  quoteToken: MoralisTokenInfo;
  priceUsd: string;
  txCount5m: string;
  txCount1h: string;
  txCount6h: string;
  txCount24h: string;
  volume5m: string;
  volume1h: string;
  volume6h: string;
  volume24h: string;
  priceChange5m: string;
  priceChange1h: string;
  priceChange6h: string;
  priceChange24h: string;
  liquidity: string;
  fdv: string;
}

class MoralisClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetchFromMoralis(endpoint: string): Promise<any> {
    if (!this.apiKey) return null;

    try {
      const url = `${MORALIS_BASE_URL}${endpoint}`;
      const res = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "X-API-Key": this.apiKey
        }
      });

      if (!res.ok) {
        console.warn(`Moralis API error: ${res.status} ${res.statusText}`);
        return null;
      }

      return await res.json();
    } catch (error) {
      console.warn(`Moralis API fetch error: ${error}`);
      return null;
    }
  }

  async getTokenInfo(address: string, chainId: number): Promise<{ address: string; symbol: string; name: string; decimals: number; logo: string | null; total_supply: string; owners: string | null; market_cap: string | null } | null> {
    const moralisChain = getMoralisChain(chainId);
    if (!moralisChain) return null;

    const data = await this.fetchFromMoralis(`/token/${address}/${moralisChain}`);
    if (!data) return null;

    return {
      address: data.address,
      symbol: data.symbol,
      name: data.name,
      decimals: typeof data.decimals === "string" ? parseInt(data.decimals) : data.decimals,
      logo: data.logo || null,
      total_supply: data.total_supply || null,
      owners: data.owners_count || null,
      market_cap: data.market_cap || null
    };
  }

  async getTokenPrice(address: string, chainId: string): Promise<number | null> {
    const moralisChain = getMoralisChain(parseInt(chainId));
    if (!moralisChain) return null;

    const data = await this.fetchFromMoralis(`/token/${address}/price?chain=${moralisChain}`);
    if (!data || !data.usdPrice) return null;

    return parseFloat(data.usdPrice);
  }

  async getPairInfo(address1: string, address2: string, chainId: number): Promise<{ dex: string; baseToken: { address: string; symbol: string; name: string; decimals: number }; quoteToken: { address: string; symbol: string; name: string; decimals: number }; priceUsd: string | null; liquidityUsd: string | null; volume24h: string | null; } | null> {
    const moralisChain = getMoralisChain(chainId);
    if (!moralisChain) return null;

    const data = await this.fetchFromMoralis(`/pair/${address1}/${address2}/${moralisChain}`);
    if (!data) return null;

    return {
      dex: data.dexId || "",
      baseToken: {
        address: data.baseToken.address,
        symbol: data.baseToken.symbol,
        name: data.baseToken.name,
        decimals: typeof data.baseToken.decimals === "string" ? parseInt(data.baseToken.decimals) : data.baseToken.decimals
      },
      quoteToken: {
        address: data.quoteToken.address,
        symbol: data.quoteToken.symbol,
        name: data.quoteToken.name,
        decimals: typeof data.quoteToken.decimals === "string" ? parseInt(data.quoteToken.decimals) : data.quoteToken.decimals
      },
      priceUsd: data.priceUsd || null,
      liquidityUsd: data.liquidity || null,
      volume24h: data.volume24h || null
    };
  }

  async getBlockNumber(chainId: number): Promise<number | null> {
    const moralisChain = getMoralisChain(chainId);
    if (!moralisChain) return null;

    const data = await this.fetchFromMoralis(`/block/${moralisChain}/latest`);
    if (!data || !data.blockNumber) return null;

    return parseInt(data.blockNumber);
  }
}

export function createMoralisClient(apiKey: string): MoralisClient {
  return new MoralisClient(apiKey);
}


