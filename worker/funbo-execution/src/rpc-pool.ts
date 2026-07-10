import { ethers } from 'ethers';
import {
  getHealthyRpcPool, markNodeHealth,
  setProvider403Blocked, getProvider403Blocked,
  urlQuotaTier, classifyProvider,
} from '../../shared/rpc-pool';
import { getRateLimitStatus, recordRateLimit, recordSuccess } from '../../shared/rate-limiter';

const RPC_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'EVM-Bot/2.0 (Cloudflare Worker)',
};

export type { NodeHealth } from '../../shared/rpc-pool';
export { getHealthyRpcPool, markNodeHealth, buildChainFallbackPool } from '../../shared/rpc-pool';

async function probeRpc(url: string, timeoutMs = 5000): Promise<{ ok: boolean; latencyMs: number; isAuthError?: boolean }> {
  const rpcService = `rpc:${url}`;
  const status = getRateLimitStatus(rpcService);
  if (!status.allowed) {
    return { ok: false, latencyMs: status.retryAfterMs };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: RPC_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const ms = Date.now() - start;
    if (res.status === 403) {
      recordRateLimit(rpcService);
      return { ok: false, latencyMs: ms, isAuthError: true };
    }
    try {
      const json = await res.clone().json() as any;
      if (json.error) {
        return { ok: false, latencyMs: ms };
      }
    } catch { return { ok: false, latencyMs: ms }; }
    recordSuccess(rpcService);
    return { ok: true, latencyMs: ms };
  } catch {
    clearTimeout(timeoutId);
    return { ok: false, latencyMs: Date.now() - start };
  }
}

function makeProvider(url: string, chainId?: number): ethers.JsonRpcProvider {
  const network = chainId ? ethers.Network.from(chainId) : undefined;
  const provider = new ethers.JsonRpcProvider(url, network, { staticNetwork: true, batchStallTime: 0 });
  const origGetConn = provider._getConnection.bind(provider);
  provider._getConnection = () => {
    const req = origGetConn();
    req.setThrottleParams({ maxAttempts: 1 });
    return req;
  };
  return provider;
}

export async function getWorkingProvider(
  env: Env,
  rpcUrl: string,
  defaultPool?: string,
  db?: any,
  chainId?: number
): Promise<{ provider: ethers.JsonRpcProvider; url: string }> {
  const pool = await getHealthyRpcPool(env, chainId ?? null, defaultPool || rpcUrl);
  pool.sort((a, b) => urlQuotaTier(a) - urlQuotaTier(b) || Math.random() - 0.5);

  for (const url of pool) {
    const blocked = env['funbo-db'] ? await getProvider403Blocked(env, url) : null;
    if (blocked) continue;

    const probe = await probeRpc(url, 2500);

    if (probe.ok) {
      await markNodeHealth(env, url, classifyProvider(url), chainId ?? null, probe.latencyMs, true);
      return { provider: makeProvider(url, chainId), url };
    }

    if (probe.latencyMs > 0 && !probe.ok) {
      await markNodeHealth(env, url, classifyProvider(url), chainId ?? null, probe.latencyMs, false);
      if (env['funbo-db'] && probe.isAuthError) {
        const blockedUntil = Math.floor(Date.now() / 1000) + 300;
        await setProvider403Blocked(env, url, blockedUntil);
      }
    }
  }

  const probe = await probeRpc(rpcUrl, 2500);
  if (probe.ok) {
    await markNodeHealth(env, rpcUrl, classifyProvider(rpcUrl), chainId ?? null, probe.latencyMs, true);
    return { provider: makeProvider(rpcUrl, chainId), url: rpcUrl };
  }

  throw new Error(`All RPC endpoints unreachable for chain ${chainId ?? 'unknown'}`);
}


