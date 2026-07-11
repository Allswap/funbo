import { Hono } from 'hono';
import { initDB } from './db';
import { dexscreenerGetPools, goplusBatchTokenSafety, isWellKnownToken, SafetyResult } from '../../shared/api-providers';
import { ethers } from 'ethers';
import { getSwapQuote, getPactSwapTokenType, STABLECOIN_SYMBOLS, PACT_SWAP_CHAIN_TYPES } from '../../shared/pactswap';
import { analyzeDiscoveredPairs } from './ai-discovery';
import { encodeV3Path, getWorkingRpcUrl, logError } from '../../shared/rpc-pool';
import { rawQuoteRoute, rawQuoteRouteAmount, rawEthCall, getTokenDecimals, V2_GET_AMOUNTS_OUT, V3_QUOTE_EXACT_INPUT, V3_FEE_TIERS, DEFAULT_AMOUNT_IN } from '../../shared/quotes';

async function writeR2Log(env: Env, bucket: string, key: string, data: any): Promise<void> {
  try {
    const r2 = env.FUNBO_R2;
    if (r2) {
      await r2.put(bucket + '/' + key, JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error('[R2] write failed:', e);
  }
}

type JsonBody = Promise<Record<string, unknown> | null>;
async function safeJson(c: any): JsonBody {
  try { return await c.req.json(); } catch { return null; }
}

async function dedupCronRun(DB: any, key: string, intervalMin: number): Promise<boolean> {
  try {
    const row = await DB.prepare('SELECT value FROM config WHERE key = ?').bind(`last_cron:${key}`).first() as { value: string } | null;
    const last = row ? parseInt(row.value) : 0;
    const now = Math.floor(Date.now() / 1000);
    if (now - last < intervalMin * 60) return false;
    await DB.prepare(`INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`).bind(`last_cron:${key}`, String(now), String(now)).run();
    return true;
  } catch { return true; }
}

const KNOWN_DEX_ROUTERS: Record<string, { name: string; address: string; version: string; quoter_address?: string }[]> = {
  '1': [
    { name: 'Uniswap V2', address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', version: 'v2' },
    { name: 'Uniswap V3', address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
    { name: 'SushiSwap V2', address: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', version: 'v2' },
    { name: 'SushiSwap V3', address: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
  ],
  '10': [
    { name: 'Uniswap V3', address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
    { name: 'SushiSwap V2', address: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', version: 'v2' },
  ],
  '137': [
    { name: 'Quickswap V2', address: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', version: 'v2' },
    { name: 'Quickswap V3', address: '0x6e2aC2092bC0B6e2D5B0bC6e7d8B0E7aB0c6D0E1', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
    { name: 'Uniswap V3', address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
    { name: 'SushiSwap V2', address: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', version: 'v2' },
  ],
  '42161': [
    { name: 'Uniswap V3', address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
    { name: 'SushiSwap V2', address: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', version: 'v2' },
    { name: 'Camelot V2', address: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d', version: 'v2' },
    { name: 'Camelot V3', address: '0x1Fc5a8Aa2E0E8b1D5e0B4c3F5b8c7D6e7F9a0B2', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
  ],
  '8453': [
    { name: 'Uniswap V3', address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
    { name: 'SushiSwap V2', address: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', version: 'v2' },
    { name: 'Aerodrome V2', address: '0xcF77a3Ba9A5CA399B7c97c74d54e5b3F9b3A1e9D', version: 'v2' },
  ],
  '56': [
    { name: 'PancakeSwap V2', address: '0x10ED43C718714eb63d5aA57B78B54704E256024E', version: 'v2' },
    { name: 'PancakeSwap V3', address: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
  ],
  '43114': [
    { name: 'Trader Joe V2', address: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4', version: 'v2' },
    { name: 'Uniswap V3', address: '0xE592427A0AEce92De3Edee1F18E0157C05861564', version: 'v3', quoter_address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
  ],
  '250': [
    { name: 'SpiritSwap V2', address: '0x16327E3FbDaCA3bcF7E38F5Af2599D2DDc33aE52', version: 'v2' },
    { name: 'SpookySwap V2', address: '0xF491e7B69E4244ad4002BC14e878a34207E38b29', version: 'v2' },
  ],
};

async function autoCreateDexRouter(DB: D1Database, chainId: number, dexName: string): Promise<void> {
  const chainKey = String(chainId);
  const routers = KNOWN_DEX_ROUTERS[chainKey];
  if (!routers) return;
  const normalized = dexName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const known of routers) {
    const knownName = known.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (knownName.includes(normalized) || normalized.includes(knownName)) {
      const existing = await DB.prepare('SELECT id FROM dex_routers WHERE LOWER(address) = LOWER(?)').bind(known.address).first();
      if (!existing) {
        await DB.prepare('INSERT INTO dex_routers (name, address, chain_id, version, quoter_address) VALUES (?, ?, ?, ?, ?)')
          .bind(known.name, known.address, chainId, known.version, known.quoter_address || null).run();
      }
      return;
    }
  }
}

const app = new Hono<{ Bindings: Env }>();

async function hashApiKey(apiKey: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

app.use('*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN || '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (c.req.method === 'OPTIONS') return c.newResponse(null, { status: 204 });

  const path = c.req.path.replace(/\/+/g, '/');
  const publicPaths = ['/api/health', '/api/cron/spot-strategies', '/api/cron/cross-dex', '/api/cron/hourly-discovery'];
  if (publicPaths.includes(path)) return next();

  const apiKey = c.req.header('X-API-Key');
  if (!apiKey) return c.json({ error: 'Missing X-API-Key' }, 401);
  const DB = c.env['funbo-db'];
  const keyHash = await hashApiKey(apiKey);
  const validKey = await DB.prepare('SELECT id FROM api_keys WHERE key_hash = ? AND is_active = 1').bind(keyHash).first();
  if (!validKey) return c.json({ error: 'Invalid or expired API Key' }, 403);
  return next();
});

app.get('/api/health', (c) => c.json({ status: 'ok', worker: 'funbo-discovery' }));

app.get('/api/discovery-pools', async (c) => {
  const DB = c.env['funbo-db'];
  const chainId = c.req.query('chainId');
  const sourceType = c.req.query('sourceType');
  let sql = 'SELECT * FROM discovery_pools'; const binds: any[] = [];
  if (chainId) { const p = parseInt(chainId); if (!isNaN(p)) { sql += ' WHERE chain_id = ?'; binds.push(p); } }
  if (sourceType) { sql += binds.length ? ' AND source_type = ?' : ' WHERE source_type = ?'; binds.push(sourceType); }
  sql += ' ORDER BY id';
  return c.json((await DB.prepare(sql).bind(...binds).all()).results);
});

app.get('/api/discovery-pools/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const DB = c.env['funbo-db'];
  const pool = await DB.prepare('SELECT * FROM discovery_pools WHERE id = ?').bind(id).first();
  return pool ? c.json(pool) : c.json({ error: 'Not found' }, 404);
});

app.patch('/api/discovery-pools/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const body = await safeJson(c);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const DB = c.env['funbo-db'];
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['chainId', 'apiUrl', 'apiKeyRef', 'intervalMinutes', 'sourceType']) {
    if (body[k] !== undefined) {
      const col = k === 'apiKeyRef' ? 'api_key_ref' : k === 'intervalMinutes' ? 'interval_minutes' : k === 'sourceType' ? 'source_type' : k;
      sets.push(`${col} = ?`); binds.push(body[k]);
    }
  }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  binds.push(id);
  await DB.prepare(`UPDATE discovery_pools SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true, message: 'Discovery pool updated' });
});

app.delete('/api/discovery-pools/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM discovery_pools WHERE id = ?').bind(id).run();
  return c.json({ success: true, message: 'Discovery pool removed' });
});


app.post('/api/token-pairs', async (c) => {
  const body = await safeJson(c);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const { chainId, tokenA, tokenB, label, dexLabel } = body as { chainId?: number; tokenA?: string; tokenB?: string; label?: string; dexLabel?: string };
  const DB = c.env['funbo-db'];
  if (!chainId || !tokenA || !tokenB) return c.json({ error: 'Chain ID, tokenA, and tokenB are required' }, 400);
  await DB.prepare('INSERT INTO token_pairs (chain_id, token_a, token_b, label, dex_label) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chain_id, token_a, token_b) DO NOTHING')
    .bind(chainId, tokenA, tokenB, label || '', dexLabel || '').run();
  return c.json({ success: true, message: 'Token pair created' });
});

app.get('/api/token-pairs', async (c) => {
  const DB = c.env['funbo-db'];
  const chainId = c.req.query('chainId');
  let sql = 'SELECT * FROM token_pairs'; const binds: any[] = [];
  if (chainId) { const p = parseInt(chainId); if (!isNaN(p)) { sql += ' WHERE chain_id = ?'; binds.push(p); } }
  sql += ' ORDER BY chain_id, id';
  return c.json((await DB.prepare(sql).bind(...binds).all()).results);
});

app.post('/api/token-pairs/recheck-security', async (c) => {
  const DB = c.env['funbo-db'];
  const rows = await DB.prepare('SELECT * FROM token_pairs ORDER BY chain_id, id').all() as { results: any[] };
  let updated = 0;
  const allNonWellKnown = new Set<string>();
  for (const pair of rows.results) {
    if (!isWellKnownToken(pair.token_a, pair.chain_id)) allNonWellKnown.add(pair.token_a.toLowerCase());
    if (!isWellKnownToken(pair.token_b, pair.chain_id)) allNonWellKnown.add(pair.token_b.toLowerCase());
  }
  const securityMap = allNonWellKnown.size > 0
    ? await goplusBatchTokenSafety(c.env, 137, [...allNonWellKnown])
    : new Map<string, SafetyResult>();
  for (const pair of rows.results) {
    const aSafe = isWellKnownToken(pair.token_a, pair.chain_id)
      ? { safe: true, reason: 'Well-known token' }
      : (securityMap.get(pair.token_a.toLowerCase()) ?? { safe: false, reason: 'Scan unavailable' });
    const bSafe = isWellKnownToken(pair.token_b, pair.chain_id)
      ? { safe: true, reason: 'Well-known token' }
      : (securityMap.get(pair.token_b.toLowerCase()) ?? { safe: false, reason: 'Scan unavailable' });
    await DB.prepare(
      'UPDATE token_pairs SET security_checked = 1, security_info = ? WHERE id = ?'
    ).bind(JSON.stringify({ tokenA: aSafe, tokenB: bSafe }), pair.id).run();
    updated++;
  }
  return c.json({ success: true, updated, total: rows.results.length });
});

app.get('/api/token-pairs/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const DB = c.env['funbo-db'];
  const pair = await DB.prepare('SELECT * FROM token_pairs WHERE id = ?').bind(id).first();
  return pair ? c.json(pair) : c.json({ error: 'Not found' }, 404);
});

app.patch('/api/token-pairs/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const body = await safeJson(c);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const DB = c.env['funbo-db'];
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['chainId', 'tokenA', 'tokenB', 'label', 'dexLabel', 'securityInfo', 'securityChecked']) {
    if (body[k] !== undefined) {
      const col = k === 'chainId' ? 'chain_id' : k === 'tokenA' ? 'token_a' : k === 'tokenB' ? 'token_b' : k === 'dexLabel' ? 'dex_label' : k === 'securityInfo' ? 'security_info' : k === 'securityChecked' ? 'security_checked' : k;
      sets.push(`${col} = ?`); binds.push(body[k]);
    }
  }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  binds.push(id);
  await DB.prepare(`UPDATE token_pairs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true, message: 'Token pair updated' });
});

app.delete('/api/token-pairs/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM token_pairs WHERE id = ?').bind(id).run();
  return c.json({ success: true, message: 'Token pair removed' });
});


const CHAIN_SLUGS: Record<number, string> = {
  1: 'eth', 10: 'optimism', 137: 'polygon', 42161: 'arbitrum', 8453: 'base', 43114: 'avalanche', 56: 'bsc', 250: 'fantom', 84532: 'base',
};

async function fetchGecko(chainId: number, apiUrl: string): Promise<DiscoveredPair[]> {
  const slug = CHAIN_SLUGS[chainId] || 'polygon';
  const url = `${apiUrl}/api/v2/networks/${slug}/trending_pools`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data: any = await res.json();
    const pairs: DiscoveredPair[] = [];
    for (const pool of (data?.data ?? []).slice(0, 10)) {
      const attrs = pool?.attributes ?? {};
      const base = pool?.relationships?.base_token?.data?.id;
      const quote = pool?.relationships?.quote_token?.data?.id;
      if (base && quote && base !== quote) pairs.push({ tokenA: base, tokenB: quote, label: attrs?.base_token_symbol || '', dexLabel: '' });
    }
    return pairs;
  } catch {
    return [];
  }
}

async function fetchDefiLlama(chainId: number, apiUrl: string): Promise<DiscoveredPair[]> {
  try {
    const CHAIN_SLUGS: Record<number, string> = {
      1: 'ethereum', 10: 'optimism', 137: 'polygon', 42161: 'arbitrum', 8453: 'base', 56: 'bsc', 250: 'fantom', 43114: 'avalanche',
    };
    const slug = CHAIN_SLUGS[chainId] || String(chainId);
    const url = `${apiUrl}/pools?chain=${slug}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data: any[] = await res.json();
    const out: DiscoveredPair[] = [];
    for (const pool of data.slice(0, 10)) {
      const a = pool?.tokens?.[0];
      const b = pool?.tokens?.[1];
      if (a && b && a !== b) out.push({ tokenA: a, tokenB: b, label: pool?.symbol || '', dexLabel: '' });
    }
    return out;
  } catch {
    return [];
  }
}

interface UpsertTokenPairOpts {
  label?: string;
  securityChecked?: number;
  securityInfo?: string;
  dexLabel?: string;
}

async function upsertTokenPair(DB: D1Database, chainId: number, tokenA: string, tokenB: string, opts?: UpsertTokenPairOpts): Promise<void> {
  await DB.prepare(`INSERT INTO token_pairs (chain_id, token_a, token_b, label, security_checked, security_info, dex_label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chain_id, token_a, token_b) DO UPDATE SET
      label = COALESCE(NULLIF(excluded.label, ''), label),
      security_checked = COALESCE(NULLIF(excluded.security_checked, 0), security_checked),
      security_info = COALESCE(NULLIF(excluded.security_info, ''), security_info),
      dex_label = COALESCE(NULLIF(excluded.dex_label, ''), dex_label)`)
    .bind(chainId, tokenA, tokenB, opts?.label || '', opts?.securityChecked ?? 0, opts?.securityInfo ?? null, opts?.dexLabel ?? null).run();
}

interface DiscoveredPair {
  tokenA: string;
  tokenB: string;
  label?: string;
  dexLabel?: string;
}

app.post('/api/discovery/run', async (c) => {
  const body = await safeJson(c);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const { chainId, sourceType } = body as { chainId?: number; sourceType?: string };
  const DB = c.env['funbo-db'];
  if (!DB) return c.json({ error: 'DB not available' }, 500);

  let pools: any[] = [];
  let res = await DB.prepare('SELECT * FROM discovery_pools WHERE is_active = 1').all();
  if (chainId) res = await DB.prepare('SELECT * FROM discovery_pools WHERE is_active = 1 AND chain_id = ?').bind(chainId).all();
  if (sourceType) res = await DB.prepare('SELECT * FROM discovery_pools WHERE is_active = 1 AND source_type = ?').bind(sourceType).all();
  pools = (res.results as Record<string, unknown>[]) ?? [];

  if (pools.length === 0) return c.json({ success: true, discovered: 0, message: 'No active discovery pools' });

  let totalNew = 0;
  const allDiscoveredPairs: DiscoveredPair[] = [];
  for (const pool of pools) {
    let pairs: DiscoveredPair[] = [];
    if (pool.source_type === 'gecko') {
      pairs = await fetchGecko(pool.chain_id, pool.api_url);
    } else if (pool.source_type === 'defillama') {
      pairs = await fetchDefiLlama(pool.chain_id, pool.api_url);
    } else if (pool.source_type === 'dexscreener') {
      pairs = await dexscreenerGetPools(pool.chain_id, pool.api_url);
    }

    for (const p of pairs) {
      if (p.dexLabel) {
        await autoCreateDexRouter(DB, pool.chain_id, p.dexLabel);
      }
    }

    const allTokens = new Set<string>();
    for (const p of pairs) { allTokens.add(p.tokenA.toLowerCase()); allTokens.add(p.tokenB.toLowerCase()); }
    const securityMap = await goplusBatchTokenSafety(c.env, pool.chain_id, [...allTokens]);

    for (const p of pairs) {
      try {
        const sa = securityMap.get(p.tokenA.toLowerCase());
        const sb = securityMap.get(p.tokenB.toLowerCase());
        const bothSafe = sa?.safe !== false && sb?.safe !== false;
        await upsertTokenPair(DB, pool.chain_id, p.tokenA, p.tokenB, {
          label: p.label,
          dexLabel: p.dexLabel,
          securityChecked: 1,
          securityInfo: JSON.stringify({
            tokenA: { safe: sa?.safe, reason: sa?.reason },
            tokenB: { safe: sb?.safe, reason: sb?.reason },
          }),
        });
        totalNew++;
        allDiscoveredPairs.push(p);
      } catch {}
    }

    await DB.prepare('UPDATE discovery_pools SET last_run = CURRENT_TIMESTAMP WHERE id = ?').bind(pool.id).run();
  }

  if (allDiscoveredPairs.length > 0 && c.env.AI) {
    c.executionCtx.waitUntil((async () => {
      const results = await analyzeDiscoveredPairs(DB, c.env.AI!, chainId || 0, allDiscoveredPairs);
      for (const r of results) {
        await DB.prepare(
          'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
        ).bind(`ai_discovery_${r.pairKey}`, JSON.stringify(r), JSON.stringify(r)).run();
      }
    })());
  }

  return c.json({ success: true, discovered: totalNew, poolsChecked: pools.length });
});


app.post('/api/scan', async (c) => {
  const body = await safeJson(c);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const { chainId, type, executeImmediately } = body as { chainId?: number; type?: 'spot' | 'cross-dex' | 'triangular' | 'all'; executeImmediately?: boolean };
  const DB = c.env['funbo-db'];
  if (!chainId) return c.json({ error: 'chainId required' }, 400);
  
  const networks = await DB.prepare('SELECT * FROM networks WHERE is_active = 1 AND chain_id = ?').bind(chainId).all() as { results: any[] };
  if (networks.results.length === 0) return c.json({ error: 'Network not found' }, 404);
  
  const scanType = type || 'all';
  const results: any = { spot: 0, crossDex: 0, triangular: 0 };
  
  if (scanType === 'spot' || scanType === 'all') {
    await scanMMStrategies(DB, networks.results, c.env);
    await scanSoloSpotStrategies(DB, networks.results, c.env);
    await scanSpotStrategies(DB, networks.results, c.env);
    results.spot = 1;
  }
  
  if (scanType === 'cross-dex' || scanType === 'all') {
    await runScanCycle(DB, networks.results, c.env, true);
    results.crossDex = 1;
  }
  
  if (scanType === 'triangular' || scanType === 'all') {
    // triangular is part of runScanCycle
    results.triangular = 1;
  }
  
  await DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .bind('last_auto_scan', new Date().toISOString(), new Date().toISOString()).run();
  
  // Log scan results to R2
  try {
    const opportunities = await DB.prepare('SELECT * FROM opportunities WHERE chain_id = ? AND created_at >= datetime("now", "-10 minutes") AND profit_pct >= ? ORDER BY created_at DESC')
      .bind(chainId || 137, 0.5).all();
    await writeR2Log(c.env, 'funbo-discovery-data', `scans/${chainId || 137}/${scanType}/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
      chainId: chainId || 137,
      scanType,
      timestamp: new Date().toISOString(),
      shard: body.shard || 1,
      totalShards: body.totalShards || 1,
      opportunityCount: (opportunities.results || []).length,
      opportunities: (opportunities.results || []).map(o => ({
        id: o.id,
        routerA: o.router_a,
        routerB: o.router_b,
        tokenA: o.token_a,
        tokenB: o.token_b,
        profitPct: o.profit_pct,
        status: o.status
      }))
    });
  } catch (e) { console.error('[R2] discovery scan log failed:', e); }
  
  return c.json({ success: true, scanType, triggered: 'external' });
});


app.post('/api/cron/spot-strategies', async (c) => {
  const DB = c.env['funbo-db'];
  if (!(await dedupCronRun(DB, 'spot_strategies', 10))) return c.json({ success: true, message: 'Skipped: already ran recently' });
  const networks = await DB.prepare('SELECT * FROM networks WHERE is_active = 1').all() as { results: any[] };
  const polygon = networks.results.filter((n: any) => n.chain_id === 137);
  if (polygon.length === 0) return c.json({ error: 'No polygon network' }, 400);
  c.executionCtx.waitUntil(runSpotStrategiesScan(DB, polygon, c.env));
  return c.json({ success: true, message: 'Spot strategies scan triggered' });
});

app.post('/api/cron/cross-dex', async (c) => {
  const body = await safeJson(c);
  const { shard, totalShards } = body as { shard?: number; totalShards?: number } || {};
  const DB = c.env['funbo-db'];
  const shardKey = `cross_dex_shard${shard || 1}`;
  if (!(await dedupCronRun(DB, shardKey, 15))) return c.json({ success: true, message: 'Skipped: already ran recently' });
  const networks = await DB.prepare('SELECT * FROM networks WHERE is_active = 1').all() as { results: any[] };
  const polygon = networks.results.filter((n: any) => n.chain_id === 137);
  if (polygon.length === 0) return c.json({ error: 'No polygon network' }, 400);
  c.executionCtx.waitUntil(runCrossDexScan(DB, polygon, c.env, shard || 1, totalShards || 1));
  return c.json({ success: true, message: 'Cross-DEX scan triggered', shard: shard || 1, totalShards: totalShards || 1 });
});

app.post('/api/cron/hourly-discovery', async (c) => {
  const DB = c.env['funbo-db'];
  if (!(await dedupCronRun(DB, 'hourly_discovery', 60))) return c.json({ success: true, message: 'Skipped: already ran recently' });
  c.executionCtx.waitUntil(runHourlyDiscovery(DB, c.env));
  return c.json({ success: true, message: 'Hourly discovery triggered' });
});


async function scanSpotStrategies(DB: any, networks: any[], env: any): Promise<void> {
  const strategies = await DB.prepare('SELECT * FROM spot_strategies WHERE is_active = 1').all() as { results: any[] };
  if (strategies.results.length === 0) return;
  console.log(`[scanner] spot_strategies=${strategies.results.length}`);

  for (const strat of strategies.results) {
    const net = networks.find((n: any) => n.chain_id === strat.chain_id);
    if (!net?.rpc_url) continue;
    const rpcUrl = await getWorkingRpcUrl(env, net.chain_id, net.rpc_url);
    const routerRow = await DB.prepare('SELECT * FROM dex_routers WHERE LOWER(address) = LOWER(?) AND chain_id = ?').bind(strat.router_address, strat.chain_id).first() as any;
    const router = {
      address: strat.router_address,
      version: routerRow?.version || 'v2',
      quoter_address: routerRow?.quoter_address || null,
    };
    try {
      const stableDecimals = await getTokenDecimals(rpcUrl, strat.stablecoin_address, strat.chain_id, env);
      const tokenDecimals = await getTokenDecimals(rpcUrl, strat.token_address, strat.chain_id, env);
      const priceQuoteIn = ethers.parseUnits('0.1', stableDecimals);
      const priceRaw = await rawQuoteRouteAmount(rpcUrl, strat.stablecoin_address, strat.token_address, router, 3000, priceQuoteIn, env);
      if (!priceRaw || priceRaw === 0n) continue;
      const currentPrice = Number(ethers.formatUnits(priceRaw, tokenDecimals));

      const openPosition = await DB.prepare('SELECT * FROM spot_positions WHERE spot_strategy_id = ? AND status = "open" ORDER BY bought_at DESC LIMIT 1').bind(strat.id).first() as any;

      if (!openPosition) {
        const refPrice = strat.reference_price ? parseFloat(strat.reference_price) : null;
        if (!refPrice) {
          await DB.prepare('UPDATE spot_strategies SET reference_price = ? WHERE id = ?').bind(String(currentPrice), strat.id).run();
          continue;
        }
        const dropPct = ((refPrice - currentPrice) / refPrice) * 100;
        if (dropPct >= strat.buy_threshold_pct) {
          await DB.prepare(
            'INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")'
          ).bind(strat.chain_id, strat.router_address, 'spot_buy', strat.stablecoin_address, strat.token_address, String(strat.id), dropPct).run();
          console.log(`[scanner] spot_buy strat=${strat.id} price=${currentPrice} drop=${dropPct.toFixed(2)}%`);
        }
      } else {
        const buyPrice = parseFloat(openPosition.buy_price);
        if (buyPrice <= 0) continue;
        const risePct = ((currentPrice - buyPrice) / buyPrice) * 100;
        if (risePct >= strat.sell_threshold_pct) {
          await DB.prepare(
            'INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")'
          ).bind(strat.chain_id, strat.router_address, 'spot_sell', openPosition.stablecoin_address, openPosition.token_address, String(openPosition.id), risePct).run();
          console.log(`[scanner] spot_sell pos=${openPosition.id} price=${currentPrice} rise=${risePct.toFixed(2)}%`);
        }
      }
    } catch (e) {
      console.error(`[scanner] spot_strat=${strat.id} error:`, e);
    }
  }
}


async function scanSoloSpotStrategies(DB: any, networks: any[], env: any): Promise<void> {
  const strategies = await DB.prepare('SELECT * FROM solo_spot_strategies WHERE is_active = 1').all() as { results: any[] };
  if (strategies.results.length === 0) return;

  const maxPairsPerStrat = 8;
  const maxRouterPairs = 10;
  const rpcDelayMs = 30;

  for (const strat of strategies.results) {
    try {
      const net = networks.find((n: any) => n.chain_id === strat.chain_id);
      if (!net?.rpc_url) continue;
      const rpcUrl = await getWorkingRpcUrl(env, net.chain_id, net.rpc_url);

      const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(strat.chain_id).all() as { results: any[] };
      const validRouters = routers.results.filter((r: any) => r.address && (r.version === 'v3' ? !!r.quoter_address : true));
      if (validRouters.length < 2) continue;

      const stratDecimals = await getTokenDecimals(rpcUrl, strat.token_address, strat.chain_id, env);
      const stratAmountWei = ethers.parseUnits(strat.trade_amount || '10', stratDecimals);

      const pairRows = await DB.prepare(
        'SELECT token_a AS partner FROM token_pairs WHERE token_b = ? AND chain_id = ? AND is_active = 1 UNION SELECT token_b AS partner FROM token_pairs WHERE token_a = ? AND chain_id = ? AND is_active = 1'
      ).bind(strat.token_address, strat.chain_id, strat.token_address, strat.chain_id).all() as { results: any[] };
      if (pairRows.results.length === 0) continue;

      let pairsDone = 0;
      for (const pair of pairRows.results) {
        if (pairsDone >= maxPairsPerStrat) break;
        const pairToken = pair.partner as string;
        let bestProfit = 0;
        let bestBuyRouter = '';
        let bestSellRouter = '';
        let routerPairsDone = 0;

        for (const buyRouter of validRouters) {
          const buyQuote = await rawQuoteRouteAmount(rpcUrl, strat.token_address, pairToken, buyRouter, 3000, stratAmountWei, env);
          if (!buyQuote || buyQuote === 0n) continue;

          for (const sellRouter of validRouters) {
            if (sellRouter.address === buyRouter.address) continue;
            if (routerPairsDone >= maxRouterPairs) break;
            const sellQuote = await rawQuoteRouteAmount(rpcUrl, pairToken, strat.token_address, sellRouter, 3000, buyQuote, env);
            if (!sellQuote || sellQuote === 0n) continue;

            const profitPct = Number((sellQuote - stratAmountWei) * 10000n / stratAmountWei) / 100;
            if (profitPct > 0 && profitPct > bestProfit) {
              bestProfit = profitPct;
              bestBuyRouter = buyRouter.address;
              bestSellRouter = sellRouter.address;
            }
            routerPairsDone++;
            if (rpcDelayMs > 0) await new Promise(r => setTimeout(r, rpcDelayMs));
          }
        }

        if (bestProfit > 0) {
          try {
            const existing = await DB.prepare(
              'SELECT id FROM opportunities WHERE token_a = ? AND token_b = ? AND router_a = ? AND router_b = ? AND status = "pending"'
            ).bind(strat.token_address, pairToken, bestBuyRouter, 'solo_spot').first();
            if (!existing) {
              await DB.prepare(
                'INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")'
              ).bind(strat.chain_id, bestBuyRouter, 'solo_spot', strat.token_address, pairToken, String(strat.id), bestProfit).run();
              console.log(`[solo-spot] strat=${strat.id} token=${strat.token_address.slice(0,8)} pair=${pairToken.slice(0,8)} profit=${bestProfit.toFixed(2)}% buy=${bestBuyRouter.slice(0,8)} sell=${bestSellRouter.slice(0,8)}`);
            }
          } catch {}
        }
        pairsDone++;
      }
    } catch (e) {
      console.error(`[solo-spot] scan error strat=${strat.id}:`, e);
    }
  }
}


async function scanMMStrategies(DB: any, networks: any[], env: any): Promise<void> {
  const configs = await DB.prepare('SELECT * FROM mm_lp_configs WHERE is_active = 1').all() as { results: any[] };
  if (configs.results.length === 0) return;

  for (const cfg of configs.results) {
    try {
      const net = networks.find((n: any) => n.chain_id === cfg.chain_id);
      if (!net?.rpc_url) continue;
      const rpcUrl = await getWorkingRpcUrl(env, net.chain_id, net.rpc_url);

      const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(cfg.chain_id).all() as { results: any[] };
      const validRouters = routers.results.filter((r: any) => r.address && (r.version === 'v3' ? !!r.quoter_address : true));
      if (validRouters.length === 0) continue;

      const pairRows = await DB.prepare(
        'SELECT token_a AS partner FROM token_pairs WHERE token_b = ? AND chain_id = ? AND is_active = 1 UNION SELECT token_b AS partner FROM token_pairs WHERE token_a = ? AND chain_id = ? AND is_active = 1'
      ).bind(cfg.token_address, cfg.chain_id, cfg.token_address, cfg.chain_id).all() as { results: any[] };
      if (pairRows.results.length === 0) continue;

      // Scan ALL pairs for this token, not just the first one
      for (const pairRow of pairRows.results) {
        const pairToken = pairRow.partner;
        
        // Find best price across all valid routers
        let bestQuote: bigint | null = null;
        let bestRouter = null;
        for (const router of validRouters) {
          const quote = await rawQuoteRoute(rpcUrl, cfg.token_address, pairToken, router, 3000, env);
          if (quote && quote > 0n && (bestQuote === null || quote > bestQuote)) {
            bestQuote = quote;
            bestRouter = router;
          }
          await new Promise(r => setTimeout(r, 50));
        }
        if (!bestQuote || bestQuote === 0n) continue;

        const currentPrice = Number(ethers.formatEther(bestQuote));

        if (!cfg.reference_price) {
          await DB.prepare('UPDATE mm_lp_configs SET reference_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(String(currentPrice), cfg.id).run();
          continue;
        }

        const refPrice = parseFloat(cfg.reference_price);
        if (refPrice <= 0) { await DB.prepare('UPDATE mm_lp_configs SET reference_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(String(currentPrice), cfg.id).run(); continue; }

        const deviation = Math.abs(currentPrice - refPrice) / refPrice * 100;
        if (deviation < cfg.rebalance_threshold_pct) continue;

        // Check for existing opportunity for THIS pair
        const existing = await DB.prepare('SELECT id FROM opportunities WHERE token_a = ? AND token_b = ? AND router_b = "mm_rebalance" AND status = "pending"').bind(cfg.token_address, pairToken).first();
        if (existing) continue;

        const direction = currentPrice > refPrice ? 'sell' : 'buy';
        await DB.prepare(
          'INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")'
        ).bind(cfg.chain_id, String(cfg.id), 'mm_rebalance', cfg.token_address, pairToken, cfg.trade_amount || '10', deviation).run();
        console.log(`[mm] rebalance cfg=${cfg.id} token=${cfg.token_address.slice(0,8)} pair=${pairToken.slice(0,8)} dir=${direction} dev=${deviation.toFixed(2)}%`);
      }
    } catch (e) {
      console.error(`[mm] scan error cfg=${cfg.id}:`, e);
    }
  }
}

function hasPair(pairs: any[], a: string, b: string): boolean {
  return pairs.some((p: any) =>
    (p.token_a?.toLowerCase() === a.toLowerCase() && p.token_b?.toLowerCase() === b.toLowerCase()) ||
    (p.token_a?.toLowerCase() === b.toLowerCase() && p.token_b?.toLowerCase() === a.toLowerCase())
  );
}

async function scanTriangularArb(
  DB: any, rpcUrl: string, chainId: number,
  allPairs: any[], routers: any[], feeTier: number,
  shard: number, totalShards: number,
  env?: any
): Promise<number> {
  const cfg = await DB.prepare('SELECT key, value FROM config WHERE key = "min_profit_pct_triangular"').first() as { value: string } | null;
  const minProfitPctTriangular = cfg ? parseFloat(cfg.value) : 1.0;
  const tokens = new Set<string>();
  for (const p of allPairs) { tokens.add(p.token_a); tokens.add(p.token_b); }
  const wellKnown = [...tokens].filter(t => isWellKnownToken(t, chainId));
  const priority = ['0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270','0x3c499c542cef5e3811e1192ce70d8cc03d5c3359','0xc2132d05d31c914a87c6611c10748aeb04b58e8f','0x8f3cf7ad23cd3cadbd9735aff958023239c6a063'];
  wellKnown.sort((a, b) => {
    const ia = priority.indexOf(a.toLowerCase());
    const ib = priority.indexOf(b.toLowerCase());
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const tokenList = wellKnown.slice(0, 10);
  let triCount = 0;
  let inserted = 0;
  const maxTriangles = 8;
  const maxRoutersPerTriangle = 4;
  const rpcDelayMs = 30;

  // Sharding: split token list across shards
  const tokensPerShard = Math.ceil(tokenList.length / totalShards);
  const startIdx = (shard - 1) * tokensPerShard;
  const endIdx = Math.min(startIdx + tokensPerShard, tokenList.length);
  const shardTokenList = tokenList.slice(startIdx, endIdx);

  for (let i = 0; i < shardTokenList.length && triCount < maxTriangles; i++) {
    for (let j = i + 1; j < shardTokenList.length && triCount < maxTriangles; j++) {
      for (let k = j + 1; k < shardTokenList.length && triCount < maxTriangles; k++) {
        const A = shardTokenList[i], B = shardTokenList[j], C = shardTokenList[k];
        if (!hasPair(allPairs, A, B) || !hasPair(allPairs, B, C) || !hasPair(allPairs, C, A)) continue;
        triCount++;
        let routerDone = 0;
        for (const router of routers) {
          if (routerDone >= maxRoutersPerTriangle) break;
          const [dA, dB, dC] = await Promise.all([
            getTokenDecimals(rpcUrl, A, chainId, env),
            getTokenDecimals(rpcUrl, B, chainId, env),
            getTokenDecimals(rpcUrl, C, chainId, env),
          ]);
          const qInAB = ethers.parseUnits('0.1', dA);
          const qInBC = ethers.parseUnits('0.1', dB);
          const qInCA = ethers.parseUnits('0.1', dC);
          const [qAB, qBC, qCA] = await Promise.all([
            rawQuoteRouteAmount(rpcUrl, A, B, router, feeTier, qInAB, env),
            rawQuoteRouteAmount(rpcUrl, B, C, router, feeTier, qInBC, env),
            rawQuoteRouteAmount(rpcUrl, C, A, router, feeTier, qInCA, env),
          ]);
          if (!qAB || !qBC || !qCA || qAB === 0n || qBC === 0n || qCA === 0n) continue;
          const amountIn = ethers.parseUnits('1', dA);
          const step2 = qAB * amountIn / qInAB;
          const step3 = qBC * step2 / qInBC;
          const step4 = qCA * step3 / qInCA;
          if (step4 > amountIn) {
            const profitPct = Number((step4 - amountIn) * 10000n / amountIn) / 100;
            if (profitPct >= minProfitPctTriangular) {
              await DB.prepare(
                'INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")'
              ).bind(chainId, router.address, router.address, A, B, ethers.formatUnits(amountIn, dA), profitPct).run();
              inserted++;
            }
          }
          routerDone++;
          if (rpcDelayMs > 0) await new Promise(r => setTimeout(r, rpcDelayMs));
        }
      }
    }
  }
  return inserted;
}


async function scanCrossChainArb(DB: any, networks: any[], feeTier: number): Promise<number> {
  let inserted = 0;
  const activeNetworks = networks.filter((n: any) => n.rpc_url && PACT_SWAP_CHAIN_TYPES[n.chain_id]);
  if (activeNetworks.length < 2) return 0;

  const chainPairs = new Map<number, any[]>();
  for (const net of activeNetworks) {
    const rows = await DB.prepare('SELECT * FROM token_pairs WHERE chain_id = ? AND is_active = 1').bind(net.chain_id).all() as { results: any[] };
    chainPairs.set(net.chain_id, rows.results || []);
  }

  for (const sym of STABLECOIN_SYMBOLS) {
    const chainsWithToken: { chainId: number; rpcUrl: string; network: any; tokenAddress: string }[] = [];
    for (const net of activeNetworks) {
      const pairs = chainPairs.get(net.chain_id) || [];
      for (const p of pairs) {
        const label = (p.label || '').toUpperCase();
        if (label === sym) {
          chainsWithToken.push({ chainId: net.chain_id, rpcUrl: net.rpc_url, network: net, tokenAddress: p.token_a });
          break;
        }
      }
    }
    if (chainsWithToken.length < 2) continue;

    for (let i = 0; i < chainsWithToken.length; i++) {
      for (let j = i + 1; j < chainsWithToken.length; j++) {
        const src = chainsWithToken[i];
        const dst = chainsWithToken[j];
        const fromType = getPactSwapTokenType(src.chainId, sym);
        const toType = getPactSwapTokenType(dst.chainId, sym);
        if (!fromType || !toType) continue;

        try {
          const amountFrom = 1000 * 10 ** 6;
          const quote = await getSwapQuote(fromType, toType, amountFrom);
          if (!quote || quote.amountTo <= 0 || quote.amountFrom <= 0) continue;

          const bridgingLossPct = (1 - quote.amountTo / quote.amountFrom) * 100;
          const reverseQuote = await getSwapQuote(toType, fromType, amountFrom);
          if (!reverseQuote || reverseQuote.amountTo <= 0) continue;
          const reverseLossPct = (1 - reverseQuote.amountTo / reverseQuote.amountFrom) * 100;

          if (bridgingLossPct < 2.0 || reverseLossPct < 2.0) {
            const betterDirection = bridgingLossPct < reverseLossPct ? 'src→dst' : 'dst→src';
            const profitPct = Math.abs(bridgingLossPct - reverseLossPct) / 2;
            if (profitPct >= 0.5) {
              await DB.prepare(
                'INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")'
              ).bind(
                src.chainId,
                `pactswap:${fromType}→${toType}`,
                `pactswap:${toType}→${fromType}`,
                src.tokenAddress,
                dst.tokenAddress,
                sym,
                profitPct,
              ).run();
              inserted++;
              console.log(`[scanner] cross-chain ${sym} chain${src.chainId}↔chain${dst.chainId} spread=${profitPct.toFixed(2)}% dir=${betterDirection}`);
            }
          }
        } catch { continue; }
      }
    }
  }
  return inserted;
}

async function runScanCycle(DB: any, networks: any[], env: any, skipTriangular = false, shard: number = 1, totalShards: number = 1): Promise<void> {
  const maxPairsPerRun = 20;
  const maxRouterPairsPerPair = 10;
  const rpcDelayMs = 30;

  for (const net of networks) {
    const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(net.chain_id).all() as { results: any[] };
    const pairs = await DB.prepare('SELECT * FROM token_pairs WHERE chain_id = ? AND is_active = 1').bind(net.chain_id).all() as { results: any[] };
    if (routers.results.length < 2 || pairs.results.length === 0) continue;

    const routerPairCount = (routers.results.length * (routers.results.length - 1)) / 2;
    const pairsToScan = Math.min(pairs.results.length, maxPairsPerRun);
    const routerPairsPerPair = Math.min(routerPairCount, maxRouterPairsPerPair);
    const estimatedWork = pairsToScan * routerPairsPerPair;
    if (estimatedWork > 300) {
      console.log(`[scanner] chain=${net.chain_id} too much work (est ${estimatedWork}), skipping to avoid CPU limit`);
      continue;
    }

    // Sharding: split pairs across shards
    const pairsPerShard = Math.ceil(pairs.results.length / totalShards);
    const startIdx = (shard - 1) * pairsPerShard;
    const endIdx = Math.min(startIdx + pairsPerShard, pairs.results.length);
    const shardPairs = pairs.results.slice(startIdx, endIdx);

    try {
      const _rpcUrl = await getWorkingRpcUrl(env, net.chain_id, net.rpc_url);
      if (!_rpcUrl) continue;
      const cfg = await DB.prepare('SELECT key, value FROM config WHERE key IN ("min_profit_pct","min_profit_pct_cross_dex","min_profit_pct_triangular")').all() as { results: { key: string; value: string }[] };
      const cfgMap = Object.fromEntries(cfg.results.map((r: any) => [r.key, r.value]));
      const minProfitPctCrossDex = parseFloat(cfgMap.min_profit_pct_cross_dex || cfgMap.min_profit_pct || '0.5');
      const minProfitPctTriangular = parseFloat(cfgMap.min_profit_pct_triangular || cfgMap.min_profit_pct || '0.5');
      let inserted = 0;
      let workDone = 0;

      for (let pIdx = 0; pIdx < shardPairs.length && workDone < maxPairsPerRun * maxRouterPairsPerPair; pIdx++) {
        const pair = shardPairs[pIdx];
        let routerPairsDone = 0;

        for (let i = 0; i < routers.results.length && routerPairsDone < maxRouterPairsPerPair; i++) {
          for (let j = i + 1; j < routers.results.length && routerPairsDone < maxRouterPairsPerPair; j++) {
            const [quoteA, quoteB] = await Promise.all([
              rawQuoteRoute(_rpcUrl, pair.token_a, pair.token_b, routers.results[i], 3000, env),
              rawQuoteRoute(_rpcUrl, pair.token_a, pair.token_b, routers.results[j], 3000, env),
            ]);
            if (!quoteA || !quoteB || quoteA === 0n || quoteB === 0n) continue;
            const bestOut = quoteA > quoteB ? quoteA : quoteB;
            const worstOut = quoteA > quoteB ? quoteB : quoteA;
            if (worstOut === 0n) continue;
            const profitBps = Number((bestOut - worstOut) * 10000n / worstOut) / 100;
            if (profitBps < minProfitPctCrossDex) continue;
            const buyRouter = quoteA > quoteB ? routers.results[i] : routers.results[j];
            const sellRouter = quoteA > quoteB ? routers.results[j] : routers.results[i];
            const tradeAmountRes = await DB.prepare('SELECT value FROM config WHERE key = "trade_amount"').first() as { value: string } | null;
            const amountIn = tradeAmountRes?.value || '0.1';
            await DB.prepare('INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")').bind(net.chain_id, buyRouter.address, sellRouter.address, pair.token_a, pair.token_b, amountIn, profitBps).run();
            inserted++;
            routerPairsDone++;
            workDone++;
            if (rpcDelayMs > 0) await new Promise(r => setTimeout(r, rpcDelayMs));
          }
        }
      }
      let triInserted = 0;
      if (routers.results.length > 0 && !skipTriangular) {
        triInserted = await scanTriangularArb(DB, _rpcUrl, net.chain_id, shardPairs, routers.results, 3000, shard, totalShards, env);
      }
      console.log(`[scanner] chain=${net.chain_id} cross_dex=${inserted} triangular=${triInserted} work=${workDone} (shard ${shard}/${totalShards})`);
    } catch (e) { console.error('[scanner] scan failed:', e); }
  }
  if (networks.length > 1) {
    const ccInserted = await scanCrossChainArb(DB, networks, 3000);
    console.log(`[scanner] cross_chain=${ccInserted}`);
  } else {
    console.log(`[scanner] cross_chain=0 (single chain mode)`);
  }
}


async function updateLastScan(DB: any, key: string) {
  await DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .bind(key, new Date().toISOString(), new Date().toISOString()).run();
}

async function runSpotStrategiesScan(DB: any, polygon: any[], env: any) {
  try {
    await scanSoloSpotStrategies(DB, polygon, env);
    await scanSpotStrategies(DB, polygon, env);
    await scanMMStrategies(DB, polygon, env);
    await updateLastScan(DB, 'last_auto_scan');
    console.log('[cron] spot strategies scan completed');
  } catch (e: any) {
    console.error('[cron] spot strategies scan failed:', e);
  }
}

async function runCrossDexScan(DB: any, polygon: any[], env: any, shard: number = 1, totalShards: number = 1) {
  try {
    await runScanCycle(DB, polygon, env, false, shard, totalShards);
    await updateLastScan(DB, 'last_auto_scan');
    console.log(`[cron] cross-dex scan completed (shard ${shard}/${totalShards})`);
  } catch (e: any) {
    console.error('[cron] cross-dex scan failed:', e);
  }
}

async function runHourlyDiscovery(DB: any, env: Env) {
  try {
    const res = await DB.prepare('SELECT * FROM discovery_pools WHERE is_active = 1').all();
    const pools = (res.results as Record<string, unknown>[]) ?? [];
    const allScheduledPairs: DiscoveredPair[] = [];

    for (const pool of pools) {
      const p = pool as { id: number; chain_id: number; api_url: string; source_type: string };
      let pairs: DiscoveredPair[] = [];
      if (p.source_type === 'gecko') {
        pairs = await fetchGecko(p.chain_id, p.api_url);
      } else if (p.source_type === 'defillama') {
        pairs = await fetchDefiLlama(p.chain_id, p.api_url);
      } else if (p.source_type === 'dexscreener') {
        pairs = await dexscreenerGetPools(p.chain_id, p.api_url);
      }

      for (const pair of pairs) {
        if (pair.dexLabel) {
          await autoCreateDexRouter(DB, p.chain_id, pair.dexLabel);
        }
      }

      const allTokens = new Set<string>();
      for (const pair of pairs) { allTokens.add(pair.tokenA.toLowerCase()); allTokens.add(pair.tokenB.toLowerCase()); }
      const securityMap = await goplusBatchTokenSafety(env, p.chain_id, [...allTokens]);

      for (const pair of pairs) {
        try {
          const sa = securityMap.get(pair.tokenA.toLowerCase());
          const sb = securityMap.get(pair.tokenB.toLowerCase());
          await upsertTokenPair(DB, p.chain_id, pair.tokenA, pair.tokenB, {
            label: pair.label,
            dexLabel: pair.dexLabel,
            securityChecked: 1,
            securityInfo: JSON.stringify({
              tokenA: { safe: sa?.safe, reason: sa?.reason },
              tokenB: { safe: sb?.safe, reason: sb?.reason },
            }),
          });
          allScheduledPairs.push(pair);
        } catch {}
      }

      await DB.prepare('UPDATE discovery_pools SET last_run = CURRENT_TIMESTAMP WHERE id = ?').bind(p.id).run();
    }

    if (allScheduledPairs.length > 0 && env.AI) {
      const results = await analyzeDiscoveredPairs(DB, env.AI!, 0, allScheduledPairs);
      for (const r of results) {
        await DB.prepare(
          'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
        ).bind(`ai_discovery_${r.pairKey}`, JSON.stringify(r), JSON.stringify(r)).run();
      }
    }
    await updateLastScan(DB, 'last_auto_scan');
    console.log('[cron] hourly discovery completed');
  } catch (e) { console.error('[discovery] hourly cron failed:', e); }
}

export async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  // Native crons removed — GH Actions handles all scheduling via HTTP endpoints.
  // This handler is kept as a no-op in case native crons are re-enabled.
}

export default { fetch: app.fetch, scheduled };
