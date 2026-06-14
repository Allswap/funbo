export type NodeHealth = {
  url: string;
  provider: string | null;
  chainId: number | null;
  status: number;
};

const DEFAULT_POOLS: Record<number, string[]> = {
   1: [
     'https://ethereum-rpc.publicnode.com',
     'https://eth.drpc.org',
     'https://1rpc.io/eth',
     'https://rpc.blockscout.com/eth',
   ],
   137: [
     'https://polygon-bor-rpc.publicnode.com',
     'https://polygon.drpc.org',
     'https://rpc.blockscout.com/polygon',
   ],
   80002: [
     'https://polygon-bor-rpc.publicnode.com',
     'https://polygon-amoy.drpc.org',
     'https://rpc.blockscout.com/polygon-amoy',
   ],
   42161: [
     'https://arbitrum-rpc.publicnode.com',
     'https://arbitrum.drpc.org',
     'https://arb1.arbitrum.io/rpc',
     'https://rpc.blockscout.com/arbitrum',
   ],
   10: [
     'https://optimism-rpc.publicnode.com',
     'https://optimism.drpc.org',
     'https://mainnet.optimism.io',
     'https://rpc.blockscout.com/optimism',
   ],
   8453: [
     'https://base-rpc.publicnode.com',
     'https://base.drpc.org',
     'https://mainnet.base.org',
     'https://rpc.blockscout.com/base',
   ],
};

export function encodeV3Path(tokens: string[], fees: number[]): string {
  let path = '0x';
  for (let i = 0; i < fees.length; i++) path += tokens[i].slice(2) + fees[i].toString(16).padStart(6, '0');
  path += tokens[tokens.length - 1].slice(2);
  return path.toLowerCase();
}

export async function hashApiKey(apiKey: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const ANKR_CHAIN_NAMES: Record<number, string> = {
  1: 'eth',
  137: 'polygon',
  80002: 'polygon_amoy',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
};

const PROVIDER_URL_PATTERNS: Record<string, (chainId: number, key: string | undefined) => string> = {
  ankr: (chainId, key) => key && ANKR_CHAIN_NAMES[chainId] ? `https://rpc.ankr.com/${ANKR_CHAIN_NAMES[chainId]}/${key}` : '',
  drpc: (chainId, key) => key ? `https://lb.drpc.org/ogrpc?network=${chainId}&api_key=${key}` : '',
  getblock: (chainId, key) => key ? `https://go.getblock.io/${key}` : '',
  nownodes: (chainId, key) => key ? `https://${chainId}.rpc.nownodes.io?api-key=${key}` : '',
  // moralis REST API is not a JSON-RPC endpoint, so it's excluded from the RPC pool
};

const PROVIDER_403_BLOCKLIST_KEY = 'rpc_403_blocklist';
function getBlockStatusKey(url: string): string {
  return `${PROVIDER_403_BLOCKLIST_KEY}:${url}`;
}

export async function getHealthyRpcPool<EnvT extends Record<string, any>>(env: EnvT, chainId: number | null, explicitPool?: string): Promise<string[]> {
  const out: string[] = [];
  const add = (urls: string[]) => urls.forEach((u) => { const v = u.trim(); if (v) out.push(v); });

  const db = env['funbo-db'];
  if (db) {
    try {
      const cfg = await db.prepare("SELECT value FROM config WHERE key = 'protected_rpc_pool'").first() as { value?: string } | null;
      if (cfg?.value) add(cfg.value.split(','));
    } catch { /* ignore */ }
  }

  if (explicitPool) add(explicitPool.split(','));

  let rows: { url: string }[] = [];
  if (db && chainId) {
    try {
      const res = await db.prepare('SELECT url FROM rpc_pools WHERE chain_id = ? AND is_active = 1 ORDER BY priority').bind(chainId).all();
      rows = (res.results as { url: string }[]) ?? [];
    } catch {
      rows = [];
    }
  }
  add(rows.map((r) => r.url));

  if (chainId && DEFAULT_POOLS[chainId]) {
    add(DEFAULT_POOLS[chainId]);
  }

  if (chainId) {
    const PROVIDER_ENV_KEYS: Record<string, keyof EnvT> = {
      ankr: 'ANKR_API_KEY' as keyof EnvT,
      drpc: 'DRPC_API_KEY' as keyof EnvT,
      getblock: 'GETBLOCK_API_KEY' as keyof EnvT,
      nownodes: 'NOWNODES_API_KEY' as keyof EnvT,
      moralis: 'MORALIS_API_KEY' as keyof EnvT,
    };
    for (const [provider, builder] of Object.entries(PROVIDER_URL_PATTERNS)) {
      const envKey = PROVIDER_ENV_KEYS[provider];
      if (!envKey) continue;
      const apiKey = env[envKey] as string | undefined;
      const url = builder(chainId, apiKey);
      if (url) add([url]);
    }
  }

  const seen = new Set<string>();
  return out.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
}

export async function markNodeHealth<EnvT extends Record<string, any>>(env: EnvT, url: string, provider: string | null, chainId: number | null, latencyMs: number | null, ok: boolean): Promise<void> {
  const db = env['funbo-db'];
  if (!db) return;
  await db.prepare(
    `INSERT INTO node_health (url, provider, chain_id, latency_ms, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET provider = excluded.provider, chain_id = excluded.chain_id, latency_ms = excluded.latency_ms, status = excluded.status, last_checked = CURRENT_TIMESTAMP`
  ).bind(url, provider ?? '', chainId ?? 0, latencyMs ?? 0, ok ? 1 : 0).run();
}

async function setProvider403Blocked<EnvT extends Record<string, any>>(env: EnvT, url: string, blockedUntil: number): Promise<void> {
  const db = env['funbo-db'];
  if (!db) return;
  await db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).bind(getBlockStatusKey(url), String(blockedUntil), String(blockedUntil)).run();
}

async function getProvider403Blocked<EnvT extends Record<string, any>>(env: EnvT, url: string): Promise<number | null> {
  const db = env['funbo-db'];
  if (!db) return null;
  const row = await db.prepare('SELECT value FROM config WHERE key = ?').bind(getBlockStatusKey(url)).first() as { value: string } | null;
  if (!row) return null;
  const until = Number(row.value);
  return until > Date.now() / 1000 ? until : null;
}

export function buildChainFallbackPool(chainId: number, explicitPool?: string): string[] {
  const out: string[] = [];
  const add = (urls: string[]) => urls.forEach((u) => { const v = u.trim(); if (v) out.push(v); });
  if (explicitPool) add(explicitPool.split(','));
  if (DEFAULT_POOLS[chainId]) add(DEFAULT_POOLS[chainId]);
  const seen = new Set<string>();
  return out.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
}

export function classifyProvider(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.includes('publicnode.com')) return 'publicnode';
  if (lower.includes('drpc')) return 'drpc';
  if (lower.includes('blockscout.com')) return 'blockscout';
  if (lower.includes('1rpc.io')) return '1rpc';
  if (lower.includes('ankr.com')) return 'ankr';
  if (lower.includes('getblock.io')) return 'getblock';
  if (lower.includes('nownodes.io')) return 'nownodes';
  if (lower.includes('ankr')) return 'ankr';
  return null;
}

export { setProvider403Blocked, getProvider403Blocked };

async function probeRpc(url: string, timeout = 3000): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return { ok: false, latencyMs: Date.now() - start };
    const data: any = await res.json();
    return { ok: !!data.result, latencyMs: Date.now() - start };
  } catch { return { ok: false, latencyMs: Date.now() - start }; }
}

export function urlQuotaTier(url: string): number {
  const provider = classifyProvider(url);
  if (!provider) return 0;
  if (url.includes('api_key=') && provider === 'drpc') return 2;
  switch (provider) {
    case 'publicnode':
    case 'blockscout':
    case '1rpc':
      return 0;
    case 'ankr':
      return 1;
    case 'getblock':
      return 2;
    case 'drpc':
      return 0;
    case 'nownodes':
      return 3;
    default:
      return 1;
  }
}

export async function getWorkingRpcUrl<EnvT extends Record<string, any>>(
  env: EnvT, chainId: number, fallbackUrl: string
): Promise<string> {
  const pool = await getHealthyRpcPool(env, chainId, fallbackUrl);
  pool.sort((a, b) => urlQuotaTier(a) - urlQuotaTier(b) || Math.random() - 0.5);
  for (const url of pool) {
    const blocked = await getProvider403Blocked(env, url);
    if (blocked) continue;
    const probe = await probeRpc(url, 2500);
    if (probe.ok) {
      await markNodeHealth(env, url, null, chainId, probe.latencyMs, true);
      return url;
    }
    if (probe.latencyMs > 0) {
      await markNodeHealth(env, url, null, chainId, probe.latencyMs, false);
    }
  }
  return fallbackUrl;
}

export async function getQuotaUsage<EnvT extends Record<string, any>>(env: EnvT, service: string, metric: string): Promise<{ limit: number; used: number; left: number } | null> {
  if (!env['funbo-db']) return null;
  const quotaRow = await env['funbo-db'].prepare('SELECT limit_value, current_usage FROM service_quotas WHERE service = ? AND metric = ?').bind(service, metric).first() as { limit_value: number; current_usage: number } | null;
  if (!quotaRow) return null;
  const row = quotaRow;
  const limit = Number(row.limit_value || 0);
  const used = Number(row.current_usage || 0);
  return { limit, used, left: Math.max(0, limit - used) };
}

export async function bumpQuotaUsage<EnvT extends Record<string, any>>(env: EnvT, service: string, metric: string, delta = 1): Promise<void> {
  if (!env['funbo-db']) return;
  await env['funbo-db'].prepare(
    'UPDATE service_quotas SET current_usage = COALESCE(current_usage, 0) + ? WHERE service = ? AND metric = ?'
  ).bind(delta, service, metric).run();
}

export async function recordUsage<EnvT extends Record<string, any>>(env: EnvT, service: string, metric: string): Promise<void> {
  await bumpQuotaUsage(env, service, metric, 1);
}

export async function logError<EnvT extends Record<string, any>>(
  env: EnvT, source: string, message: string, opts?: { level?: string; details?: any; chain_id?: number; worker?: string }
): Promise<void> {
  try {
    const db = (env as any)['funbo-db'];
    if (!db) return;
    await db.prepare(
      'INSERT INTO error_logs (source, level, message, details, chain_id, worker) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      source,
      opts?.level || 'error',
      message,
      opts?.details ? JSON.stringify(opts.details) : null,
      opts?.chain_id || null,
      opts?.worker || null
    ).run();
  } catch {}
}

export async function resetUsageIfWindowExpired<EnvT extends Record<string, any>>(env: EnvT, service: string, metric: string): Promise<void> {
  if (!env['funbo-db']) return;
  const windowRow = await env['funbo-db'].prepare('SELECT current_usage, last_reset, window_seconds FROM service_quotas WHERE service = ? AND metric = ?').bind(service, metric).first() as { current_usage: number; last_reset: number; window_seconds: number } | null;
  if (!windowRow) return;
  const row = windowRow;
  const lastReset = Number(row.last_reset || 0);
  const window = Number(row.window_seconds || 86400);
  const elapsed = Math.floor(Date.now() / 1000) - lastReset;
  if (elapsed >= window) {
    await env['funbo-db'].prepare('UPDATE service_quotas SET current_usage = 0, last_reset = ? WHERE service = ? AND metric = ?').bind(Math.floor(Date.now() / 1000), service, metric).run();
  }
}

export async function seedDefaultQuotas<EnvT extends Record<string, any>>(env: EnvT, provider: string): Promise<void> {
  if (!env['funbo-db']) return;
  const quotas = [
    { service: provider, metric: 'requests_per_minute', limit: 120 },
    { service: provider, metric: 'requests_per_day', limit: 10000 },
  ];
  for (const q of quotas) {
    try {
      await env['funbo-db'].prepare(
        `INSERT INTO service_quotas (service, metric, limit_value) VALUES (?, ?, ?) ON CONFLICT(service, metric) DO NOTHING`
      ).bind(q.service, q.metric, q.limit).run();
    } catch {}
  }
}

export async function getQuotaUsageAll<EnvT extends Record<string, any>>(env: EnvT): Promise<
  { service: string; metric: string; limit_value: number; current_usage: number; window_seconds: number }[]
> {
  if (!env['funbo-db']) return [];
  const res = await env['funbo-db'].prepare('SELECT service, metric, limit_value, current_usage, window_seconds FROM service_quotas').all();
  return ((res.results as { service: string; metric: string; limit_value: number; current_usage: number; window_seconds: number }[]) ?? []).map((r) => ({
    service: r.service,
    metric: r.metric,
    limit_value: Number(r.limit_value ?? 0),
    current_usage: Number(r.current_usage ?? 0),
    window_seconds: Number(r.window_seconds ?? 86400),
  }));
}

export async function autoAdjustQuotas<EnvT extends Record<string, any>>(env: EnvT): Promise<void> {
  if (!env['funbo-db']) return;
  const rows = await getQuotaUsageAll(env);
  for (const row of rows) {
    if (row.limit_value <= 0) continue;
    const usagePct = row.current_usage / row.limit_value;
    if (usagePct > 0.85 && row.limit_value < 100_000) {
      const newLimit = Math.min(100_000, Math.floor(row.limit_value * 1.5));
      await env['funbo-db'].prepare(
        'UPDATE service_quotas SET limit_value = ? WHERE service = ? AND metric = ?'
      ).bind(newLimit, row.service, row.metric).run();
    } else if (usagePct < 0.3 && row.limit_value > 100) {
      const newLimit = Math.max(100, Math.floor(row.limit_value * 0.8));
      await env['funbo-db'].prepare(
        'UPDATE service_quotas SET limit_value = ? WHERE service = ? AND metric = ?'
      ).bind(newLimit, row.service, row.metric).run();
    }
  }
}

export async function resetAllUsageIfWindowExpired<EnvT extends Record<string, any>>(env: EnvT): Promise<void> {
  if (!env['funbo-db']) return;
  const rows = await getQuotaUsageAll(env);
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows) {
    const lastResetRow = await env['funbo-db'].prepare('SELECT last_reset FROM service_quotas WHERE service = ? AND metric = ?').bind(row.service, row.metric).first() as { last_reset: string } | null;
    const lastReset = Number(lastResetRow?.last_reset || 0);
    if (now - lastReset >= row.window_seconds) {
      await env['funbo-db'].prepare(
        'UPDATE service_quotas SET current_usage = 0, last_reset = ? WHERE service = ? AND metric = ?'
      ).bind(now, row.service, row.metric).run();
    }
  }
}
