import { Hono } from 'hono';
import { initDB, hashApiKey } from './db';
import { checkTokenTradeHistory } from './api-providers';
import { askAi } from './ai-gateway';

async function safeJson(c: any): Promise<Record<string, unknown> | null> {
  try { return await c.req.json(); } catch { return null; }
}

function validateNumeric(val: any, name: string, min?: number, max?: number): number | null {
  if (val === undefined || val === null) return null;
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return null;
  if (min !== undefined && num < min) return null;
  if (max !== undefined && num > max) return null;
  return num;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN || '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (c.req.method === 'OPTIONS') return c.newResponse(null, { status: 204 });
  await initDB(c.env);

  const apiKey = c.req.header('X-API-Key');
  const path = c.req.path.replace(/\/+/g, '/');
  const publicPaths = ['/', '/api/setup-check', '/api/setup-key', '/api/login-password', '/api/auth/nonce', '/api/auth/wallet', '/api/auth/verify', '/api/errors/log'];
  if (publicPaths.includes(path) || path.startsWith('/api/setup')) return next();
  if (!apiKey) return c.json({ error: 'Missing X-API-Key' }, 401);
  const DB = c.env['funbo-db'];
  const keyHash = await hashApiKey(apiKey);
  const validKey = await DB.prepare('SELECT id FROM api_keys WHERE key_hash = ? AND is_active = 1').bind(keyHash).first();
  if (!validKey) return c.json({ error: 'Invalid or expired API Key' }, 403);
  return next();
});

app.get('/api/setup-check', async (c) => {
  const DB = c.env['funbo-db'];
  const hasKeys = await DB.prepare('SELECT COUNT(*) as count FROM api_keys').first() as { count: number };
  return c.json({ hasKeys: hasKeys.count > 0, needsSetup: hasKeys.count === 0 });
});

app.post('/api/setup-key', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { name } = (body as { name?: string }) || {};
  let systemKey = crypto.randomUUID();
  const systemKeyRes = await DB.prepare('SELECT value FROM config WHERE key = "system_api_key"').first() as { value: string } | null;
  if (systemKeyRes?.value) systemKey = systemKeyRes.value;
  else await DB.prepare('INSERT INTO config (key, value) VALUES (?, ?)').bind('system_api_key', systemKey).run();
  const keyHash = await hashApiKey(systemKey);
  await DB.prepare('INSERT OR REPLACE INTO api_keys (key_hash, name, is_active) VALUES (?, ?, 1)').bind(keyHash, name || 'dashboard').run();
  return c.json({ success: true, key: systemKey });
});

app.post('/api/login-password', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { password } = (body as { password?: string }) || {};
  const configuredPassword = await DB.prepare('SELECT value FROM config WHERE key = "default_password"').first() as { value: string } | null;
  if (!configuredPassword) return c.json({ error: 'Password not configured. Set default_password via config.' }, 403);
  if (password === configuredPassword.value) {
    const systemKeyRes = await DB.prepare('SELECT value FROM config WHERE key = "system_api_key"').first() as { value: string } | null;
    return c.json({ success: true, apiKey: systemKeyRes?.value || '' });
  }
  return c.json({ error: 'Invalid password' }, 403);
});


app.get('/api/auth/nonce', async (c) => {
  const address = c.req.query('address');
  if (!address) return c.json({ error: 'address required' }, 400);
  const nonce = crypto.randomUUID();
  const DB = c.env['funbo-db'];
  await DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(`nonce:${address.toLowerCase()}`, nonce).run();
  return c.json({ nonce });
});

app.post('/api/auth/wallet', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { address, signature, message } = body as { address?: string; signature?: string; message?: string } || {};
  if (!address || !signature || !message) return c.json({ error: 'address, signature, and message required' }, 400);
  const addrKey = address.toLowerCase();
  const nonceRow = await DB.prepare('SELECT value FROM config WHERE key = ?').bind(`nonce:${addrKey}`).first() as { value: string } | null;
  if (!nonceRow) return c.json({ error: 'No nonce requested. Connect wallet first.' }, 400);
  const expectedMsg = `Authorize funbo dashboard\nNonce: ${nonceRow.value}`;
  if (message !== expectedMsg) return c.json({ error: 'Message mismatch' }, 400);
  let recovered: string;
  try {
    const sig = signature.startsWith('0x') ? signature : `0x${signature}`;
    const { ethers } = await import('ethers');
    recovered = ethers.verifyMessage(message, sig).toLowerCase();
  } catch {
    return c.json({ error: 'Signature verification failed' }, 400);
  }
  if (recovered !== addrKey) return c.json({ error: 'Signer does not match address' }, 400);
  await DB.prepare('DELETE FROM config WHERE key = ?').bind(`nonce:${addrKey}`).run();
  const systemKeyRes = await DB.prepare('SELECT value FROM config WHERE key = "system_api_key"').first() as { value: string } | null;
  const apiKey = systemKeyRes?.value;
  if (!apiKey) return c.json({ error: 'System not initialized. Use password login or run setup.' }, 500);
  await ensureKeyExists(DB, apiKey, address);
  return c.json({ success: true, apiKey });
});

async function ensureKeyExists(DB: any, apiKey: string, label: string) {
  const keyHash = await hashApiKey(apiKey);
  const existing = await DB.prepare('SELECT id FROM api_keys WHERE key_hash = ?').bind(keyHash).first();
  if (!existing) {
    await DB.prepare('INSERT OR REPLACE INTO api_keys (key_hash, name, is_active) VALUES (?, ?, 1)').bind(keyHash, `wallet:${label}`).run();
  }
}


app.post('/api/networks', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { chainId, name, rpcUrl, explorerUrl } = body as { chainId?: number; name?: string; rpcUrl?: string; explorerUrl?: string } || {};
  if (!chainId || !rpcUrl) return c.json({ error: 'Chain ID and RPC URL are required' }, 400);
  const existing = await DB.prepare('SELECT id FROM networks WHERE chain_id = ?').bind(chainId).first();
  if (existing) { await DB.prepare('UPDATE networks SET rpc_url = ?, name = ?, explorer_url = ?, is_active = 1 WHERE chain_id = ?').bind(rpcUrl, name, explorerUrl || '', chainId).run(); return c.json({ success: true, message: 'Network updated' }); }
  await DB.prepare('INSERT INTO networks (chain_id, name, rpc_url, explorer_url, is_active) VALUES (?, ?, ?, ?, 1)').bind(chainId, name, rpcUrl, explorerUrl || '').run();
  return c.json({ success: true, message: 'Network added' });
});
app.get('/api/networks', async (c) => { const DB = c.env['funbo-db']; return c.json((await DB.prepare('SELECT * FROM networks ORDER BY chain_id').all()).results); });
app.delete('/api/networks/:chainId', async (c) => { const id = parseInt(c.req.param('chainId')); const DB = c.env['funbo-db']; await DB.prepare('UPDATE networks SET is_active = 0 WHERE chain_id = ?').bind(id).run(); return c.json({ success: true, message: 'Network deactivated' }); });


app.post('/api/routers', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { name, address, chainId, version, quoterAddress, feeTiers } = body as { name?: string; address?: string; chainId?: number; version?: string; quoterAddress?: string; feeTiers?: string } || {};
  if (!name || !address || !chainId) return c.json({ error: 'Name, address, and chain ID are required' }, 400);
  const ver = (version || 'v2').toLowerCase();
  await DB.prepare('INSERT INTO dex_routers (name, address, chain_id, version, quoter_address, fee_tiers) VALUES (?, ?, ?, ?, ?, ?)').bind(name, address, chainId, ver, quoterAddress || null, feeTiers || null).run();
  return c.json({ success: true, message: 'DEX router added' });
});
app.get('/api/routers', async (c) => {
  const DB = c.env['funbo-db'];
  const chainId = c.req.query('chainId');
  let sql = 'SELECT * FROM dex_routers'; const binds: any[] = [];
  if (chainId) { const p = parseInt(chainId); if (!isNaN(p)) { sql += ' WHERE chain_id = ?'; binds.push(p); } }
  return c.json((await DB.prepare(sql + ' ORDER BY name').bind(...binds).all()).results);
});
app.patch('/api/routers/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const body = await safeJson(c); const DB = c.env['funbo-db'];
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['name', 'address', 'version', 'quoterAddress', 'feeTiers']) if (body[k] !== undefined) { const col = k === 'quoterAddress' ? 'quoter_address' : k === 'feeTiers' ? 'fee_tiers' : k; sets.push(`${col} = ?`); binds.push(body[k]); }
  if (body.chainId !== undefined) { const ci = validateNumeric(body.chainId, 'chainId', 1); if (ci === null) return c.json({ error: 'Invalid chainId' }, 400); sets.push('chain_id = ?'); binds.push(ci); }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  binds.push(id); await DB.prepare(`UPDATE dex_routers SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true, message: 'DEX router updated' });
});
app.delete('/api/routers/:id', async (c) => { const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db']; await DB.prepare('DELETE FROM dex_routers WHERE id = ?').bind(id).run(); return c.json({ success: true, message: 'DEX router removed' }); });


app.post('/api/rpc-pools', async (c) => { const DB = c.env['funbo-db']; const body = await safeJson(c); const { chainId, url, priority } = body as { chainId?: number; url?: string; priority?: number } || {}; if (!chainId || !url) return c.json({ error: 'Chain ID and URL are required' }, 400); await DB.prepare('INSERT OR REPLACE INTO rpc_pools (chain_id, url, priority) VALUES (?, ?, ?)').bind(chainId, url, priority || 0).run(); return c.json({ success: true, message: 'RPC pool added' }); });
app.get('/api/rpc-pools', async (c) => { const DB = c.env['funbo-db']; return c.json((await DB.prepare('SELECT * FROM rpc_pools ORDER BY chain_id, priority, id').all()).results); });
app.delete('/api/rpc-pools/:id', async (c) => { const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db']; await DB.prepare('DELETE FROM rpc_pools WHERE id = ?').bind(id).run(); return c.json({ success: true, message: 'RPC pool removed' }); });


const RPC_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'EVM-Bot/2.0 (Cloudflare Worker)',
};

async function probeRpc(url: string, timeoutMs = 2500): Promise<{ ok: boolean; latencyMs: number }> {
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
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch { clearTimeout(timeoutId); return { ok: false, latencyMs: Date.now() - start }; }
}

const DEFAULT_POOLS: Record<number, string[]> = {
   1: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth', 'https://rpc.blockscout.com/eth'],
   137: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://rpc.blockscout.com/polygon'],
   42161: ['https://arbitrum-rpc.publicnode.com', 'https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc', 'https://rpc.blockscout.com/arbitrum'],
   10: ['https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org', 'https://mainnet.optimism.io', 'https://rpc.blockscout.com/optimism'],
   8453: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org', 'https://rpc.blockscout.com/base'],
   56: ['https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org', 'https://bsc-dataseed.binance.org'],
   43114: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org', 'https://api.avax.network/ext/bc/C/rpc'],
   250: ['https://fantom-rpc.publicnode.com', 'https://fantom.drpc.org', 'https://rpc.fantom.network'],
};

app.get('/api/nodes/health', async (c) => {
  const DB = c.env['funbo-db'];
  const rows = await DB.prepare('SELECT url, provider, chain_id, latency_ms, status, last_checked FROM node_health ORDER BY last_checked DESC LIMIT 50').all();
  return c.json(rows.results);
});

app.post('/api/nodes/check', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { chainId } = (body as { chainId?: number }) || {};
  if (!chainId) return c.json({ error: 'chainId required' }, 400);
  const rows = await DB.prepare('SELECT url FROM rpc_pools WHERE chain_id = ? AND is_active = 1').bind(chainId).all() as { results: { url: string }[] };
  const urls = rows.results.map((r: any) => r.url);
  if (DEFAULT_POOLS[chainId]) urls.push(...DEFAULT_POOLS[chainId]);
  const results: { url: string; ok: boolean; latencyMs: number }[] = [];
  for (const url of [...new Set(urls)]) {
    const { ok, latencyMs } = await probeRpc(url);
    results.push({ url, ok, latencyMs });
    await DB.prepare('INSERT INTO node_health (url, chain_id, latency_ms, status) VALUES (?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET chain_id = excluded.chain_id, latency_ms = excluded.latency_ms, status = excluded.status, last_checked = CURRENT_TIMESTAMP')
      .bind(url, chainId, latencyMs, ok ? 1 : 0).run();
  }
  return c.json({ success: true, checked: results.length, results });
});

app.post('/api/nodes/preset', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { chainId } = (body as { chainId?: number }) || {};
  if (!chainId) return c.json({ error: 'chainId required' }, 400);
  const pool = DEFAULT_POOLS[chainId];
  if (!pool) return c.json({ error: 'No default pool for this chain' }, 404);
  let added = 0;
  for (const url of pool) {
    try {
      await DB.prepare('INSERT OR IGNORE INTO rpc_pools (chain_id, url, priority) VALUES (?, ?, ?)').bind(chainId, url, 0).run();
      added++;
    } catch {}
  }
  return c.json({ success: true, added, total: pool.length });
});


app.post('/api/discovery-pools', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { chainId, apiUrl, apiKeyRef, intervalMinutes, sourceType, isActive } = body as { chainId?: number; apiUrl?: string; apiKeyRef?: string; intervalMinutes?: number; sourceType?: string; isActive?: boolean } || {};
  if (!chainId || !apiUrl || !sourceType) return c.json({ error: 'chainId, apiUrl, and sourceType are required' }, 400);
  await DB.prepare('INSERT INTO discovery_pools (chain_id, api_url, api_key_ref, interval_minutes, source_type, is_active) VALUES (?, ?, ?, ?, ?, ?)').bind(chainId, apiUrl, apiKeyRef || null, intervalMinutes || 60, sourceType, isActive !== false ? 1 : 0).run();
  return c.json({ success: true, message: 'Discovery pool added' });
});
app.get('/api/discovery-pools', async (c) => { const DB = c.env['funbo-db']; return c.json((await DB.prepare('SELECT * FROM discovery_pools ORDER BY id').all()).results); });
app.delete('/api/discovery-pools/:id', async (c) => { const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db']; await DB.prepare('DELETE FROM discovery_pools WHERE id = ?').bind(id).run(); return c.json({ success: true, message: 'Discovery pool removed' }); });


app.post('/api/config', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c);
  const { key, value } = (body as { key?: string; value?: string }) || {};
  if (!key || value === undefined) return c.json({ error: 'key and value are required' }, 400);
  await DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, String(value)).run();
  return c.json({ success: true, message: 'Config saved' });
});
app.get('/api/config/:key', async (c) => {
  const DB = c.env['funbo-db']; const k = c.req.param('key');
  const row = await DB.prepare('SELECT value FROM config WHERE key = ?').bind(k).first() as { value: string } | null;
  return c.json({ key: k, value: row?.value ?? null });
});
app.get('/api/config', async (c) => {
  const DB = c.env['funbo-db'];
  return c.json((await DB.prepare('SELECT key, value FROM config').all()).results);
});


app.post('/api/wallets', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { label, address, chainId, minBalancePct, maxBalancePct, minBalanceAmount, strategyType } = (body as any) || {};
  if (!label || !address) return c.json({ error: 'label and address required' }, 400);
  try {
    await DB.prepare('INSERT INTO wallets (label, address, chain_id, min_balance_pct, max_balance_pct, min_balance_amount, strategy_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(label, address, chainId || null, minBalancePct ?? 0.1, maxBalancePct ?? 50.0, minBalanceAmount || null, strategyType || 'arb').run();
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Wallet already exists for this address and strategy' }, 409);
    }
    throw e;
  }
  return c.json({ success: true });
});
app.get('/api/wallets', async (c) => {
  const DB = c.env['funbo-db'];
  return c.json((await DB.prepare('SELECT * FROM wallets ORDER BY label').all()).results);
});
app.delete('/api/wallets/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM wallets WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});
app.patch('/api/wallets/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const body = await safeJson(c); const DB = c.env['funbo-db'];
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['label', 'address', 'minBalanceAmount', 'strategyType']) if (body[k] !== undefined) { const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); sets.push(`${col} = ?`); binds.push(body[k]); }
  if (body.chainId !== undefined) { const ci = validateNumeric(body.chainId, 'chainId', 1); if (ci === null) return c.json({ error: 'Invalid chainId' }, 400); sets.push('chain_id = ?'); binds.push(ci); }
  if (body.minBalancePct !== undefined) { const v = validateNumeric(body.minBalancePct, 'minBalancePct', 0, 100); if (v === null) return c.json({ error: 'Invalid minBalancePct (0-100)' }, 400); sets.push('min_balance_pct = ?'); binds.push(v); }
  if (body.maxBalancePct !== undefined) { const v = validateNumeric(body.maxBalancePct, 'maxBalancePct', 0, 100); if (v === null) return c.json({ error: 'Invalid maxBalancePct (0-100)' }, 400); sets.push('max_balance_pct = ?'); binds.push(v); }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields' }, 400);
  binds.push(id); await DB.prepare(`UPDATE wallets SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true });
});


app.post('/api/token-pairs', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { chainId, tokenA, tokenB, label, dexLabel } = (body as any) || {};
  if (!chainId || !tokenA || !tokenB) return c.json({ error: 'chainId, tokenA, tokenB required' }, 400);
  await DB.prepare('INSERT INTO token_pairs (chain_id, token_a, token_b, label, dex_label) VALUES (?, ?, ?, ?, ?)').bind(chainId, tokenA, tokenB, label || null, dexLabel || null).run();
  return c.json({ success: true });
});
app.get('/api/token-pairs', async (c) => {
  const DB = c.env['funbo-db']; const chainId = c.req.query('chainId');
  let sql = 'SELECT * FROM token_pairs'; const binds: any[] = [];
  if (chainId) { const p = parseInt(chainId); if (!isNaN(p)) { sql += ' WHERE chain_id = ?'; binds.push(p); } }
  return c.json((await DB.prepare(sql + ' ORDER BY id').bind(...binds).all()).results);
});
app.patch('/api/token-pairs/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const body = await safeJson(c); const DB = c.env['funbo-db'];
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['label', 'dexLabel', 'isActive']) if ((body as any)[k] !== undefined) { sets.push(`${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`); binds.push((body as any)[k]); }
  if (!sets.length) return c.json({ error: 'No fields' }, 400);
  binds.push(id); await DB.prepare(`UPDATE token_pairs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true });
});
app.delete('/api/token-pairs/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM token_pairs WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});


app.get('/api/trades', async (c) => {
  const DB = c.env['funbo-db']; const walletLabel = c.req.query('walletLabel'); const limit = parseInt(c.req.query('limit') || '100');
  let sql = 'SELECT * FROM trades'; const binds: any[] = [];
  if (walletLabel) { sql += ' WHERE wallet_label = ?'; binds.push(walletLabel); }
  return c.json((await DB.prepare(sql + ' ORDER BY created_at DESC LIMIT ?').bind(...binds, limit).all()).results);
});


app.post('/api/opportunities', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status } = (body as any) || {};
  if (!chain_id || !router_a || !router_b || !token_a || !token_b) return c.json({ error: 'chain_id, router_a, router_b, token_a, token_b required' }, 400);
  await DB.prepare('INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(chain_id, router_a, router_b, token_a, token_b, amount_in || '0', profit_pct || 0, status || 'pending').run();
  return c.json({ success: true, message: 'Opportunity created' });
});

app.get('/api/opportunities', async (c) => {
  const DB = c.env['funbo-db']; const chainId = c.req.query('chainId'); const status = c.req.query('status'); const limit = parseInt(c.req.query('limit') || '100');
  let sql = 'SELECT * FROM opportunities WHERE 1=1'; const binds: any[] = [];
  if (chainId) { const p = parseInt(chainId); if (!isNaN(p)) { sql += ' AND chain_id = ?'; binds.push(p); } }
  if (status) { sql += ' AND status = ?'; binds.push(status); }
  const limitNum = Math.min(isNaN(limit) ? 100 : limit, 500);
  return c.json((await DB.prepare(sql + ' ORDER BY created_at DESC LIMIT ?').bind(...binds, limitNum).all()).results);
});

app.get('/api/opportunities/stats', async (c) => {
  const DB = c.env['funbo-db'];
  const stats = await DB.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) as executed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(profit_pct) as avg_profit_pct,
      MAX(profit_pct) as max_profit_pct,
      MIN(created_at) as first_created,
      MAX(created_at) as last_created
    FROM opportunities
  `).first();
  return c.json(stats);
});

app.get('/api/trades/details', async (c) => {
  const DB = c.env['funbo-db'];
  const chainId = c.req.query('chainId');
  const strategy = c.req.query('strategy');
  const limit = parseInt(c.req.query('limit') || '100');
  let sql = 'SELECT * FROM trades WHERE 1=1';
  const binds: any[] = [];
  if (chainId) { sql += ' AND chain_id = ?'; binds.push(parseInt(chainId)); }
  if (strategy) { sql += ' AND strategy = ?'; binds.push(strategy); }
  const limitNum = Math.min(isNaN(limit) ? 100 : limit, 500);
  const trades = (await DB.prepare(sql + ' ORDER BY created_at DESC LIMIT ?').bind(...binds, limitNum).all()).results;
  
  // Also get from bot_transactions for detailed receipts
  const detailed = await DB.prepare(`
    SELECT * FROM bot_transactions 
    WHERE chain_id = COALESCE(?, chain_id)
    ORDER BY created_at DESC LIMIT ?
  `).bind(chainId || null, limitNum).all();
  
  return c.json({ trades, details: detailed.results });
});

app.get('/api/r2/files', async (c) => {
  const env = c.env;
  const bucket = c.req.query('bucket') || 'funbo-execution-data';
  const prefix = c.req.query('prefix') || '';
  const limit = parseInt(c.req.query('limit') || '100');
  
  try {
    const r2 = c.env.FUNBO_R2;
    if (!r2) return c.json({ error: 'R2 not configured' }, 500);
    
    const listed = await r2.list({ prefix, limit });
    const files = listed.objects.map((obj: any) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
      etag: obj.httpEtag,
      url: `/api/r2/files/${bucket}/${encodeURIComponent(obj.key)}`
    }));
    
    return c.json({ bucket, prefix, files, truncated: listed.truncated });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get('/api/r2/files/:bucket/*', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const key = c.req.param('*');
    const r2 = c.env.FUNBO_R2;
    if (!r2) return c.json({ error: 'R2 not configured' }, 500);
    
    const obj = await r2.get(bucket, key);
    if (!obj) return c.json({ error: 'Not found' }, 404);
    
    const body = await obj.text();
    return c.json(JSON.parse(body));
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});


app.post('/api/security', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { name, provider, apiKeyRef, params, priority, isActive } = (body as any) || {};
  if (!name || !provider) return c.json({ error: 'name and provider required' }, 400);
  await DB.prepare('INSERT INTO security_layers (name, provider, api_key_ref, params, priority, is_active) VALUES (?, ?, ?, ?, ?, ?)').bind(name, provider, apiKeyRef || null, params || null, priority ?? 0, isActive !== false ? 1 : 0).run();
  return c.json({ success: true });
});
app.get('/api/security', async (c) => {
  const DB = c.env['funbo-db']; const provider = c.req.query('provider');
  let sql = 'SELECT * FROM security_layers'; const binds: any[] = [];
  if (provider) { sql += ' WHERE provider = ?'; binds.push(provider); }
  return c.json((await DB.prepare(sql + ' ORDER BY priority').bind(...binds).all()).results);
});
app.patch('/api/security/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const body = await safeJson(c); const DB = c.env['funbo-db'];
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['name', 'provider', 'apiKeyRef', 'params']) if (body[k] !== undefined) { const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); sets.push(`${col} = ?`); binds.push(body[k]); }
  if (body.priority !== undefined) { const v = validateNumeric(body.priority, 'priority', 0); if (v === null) return c.json({ error: 'Invalid priority' }, 400); sets.push('priority = ?'); binds.push(v); }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields' }, 400);
  binds.push(id); await DB.prepare(`UPDATE security_layers SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true });
});
app.delete('/api/security/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM security_layers WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});


app.post('/api/strategies', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { key, name, description, params } = (body as any) || {};
  if (!key || !name) return c.json({ error: 'key and name required' }, 400);
  await DB.prepare('INSERT INTO trade_strategies (key, name, description, params) VALUES (?, ?, ?, ?)').bind(key, name, description || null, params || null).run();
  return c.json({ success: true });
});
app.get('/api/strategies', async (c) => {
  const DB = c.env['funbo-db'];
  return c.json((await DB.prepare('SELECT * FROM trade_strategies WHERE is_active = 1 ORDER BY name').all()).results);
});
app.delete('/api/strategies/:key', async (c) => {
  const key = c.req.param('key'); const DB = c.env['funbo-db'];
  await DB.prepare("UPDATE trade_strategies SET is_active = 0 WHERE key = ?").bind(key).run();
  return c.json({ success: true });
});


app.post('/api/spot-strategies', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { chainId, tokenAddress, stablecoinAddress, routerAddress, buyThresholdPct, sellThresholdPct, tradeAmount } = (body as any) || {};
  if (!chainId || !tokenAddress || !stablecoinAddress || !routerAddress) return c.json({ error: 'chainId, tokenAddress, stablecoinAddress, routerAddress required' }, 400);
  const net = await DB.prepare('SELECT chain_id, explorer_url FROM networks WHERE chain_id = ? AND is_active = 1').bind(chainId).first() as any;
  if (!net) return c.json({ error: `Chain ${chainId} not configured or inactive` }, 400);
  if (net.explorer_url) {
    const history = await checkTokenTradeHistory(net.explorer_url, c.env.BLOCKSCOUT_API_KEY, chainId, tokenAddress);
    if (!history.safe) {
      return c.json({ error: `Token history check failed: ${history.reason}` }, 400);
    }
  }
  await DB.prepare('INSERT INTO spot_strategies (chain_id, token_address, stablecoin_address, router_address, buy_threshold_pct, sell_threshold_pct, trade_amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(chainId, tokenAddress, stablecoinAddress, routerAddress, buyThresholdPct ?? 5.0, sellThresholdPct ?? 5.0, tradeAmount ?? '10').run();
  return c.json({ success: true });
});
app.get('/api/spot-strategies', async (c) => {
  const DB = c.env['funbo-db'];
  return c.json((await DB.prepare('SELECT * FROM spot_strategies ORDER BY id').all()).results);
});
app.patch('/api/spot-strategies/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const body = await safeJson(c); const DB = c.env['funbo-db'];
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['tokenAddress', 'stablecoinAddress', 'routerAddress', 'tradeAmount', 'referencePrice']) if (body[k] !== undefined) { const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); sets.push(`${col} = ?`); binds.push(body[k]); }
  if (body.buyThresholdPct !== undefined) { const v = validateNumeric(body.buyThresholdPct, 'buyThresholdPct', 0); if (v === null) return c.json({ error: 'Invalid buyThresholdPct' }, 400); sets.push('buy_threshold_pct = ?'); binds.push(v); }
  if (body.sellThresholdPct !== undefined) { const v = validateNumeric(body.sellThresholdPct, 'sellThresholdPct', 0); if (v === null) return c.json({ error: 'Invalid sellThresholdPct' }, 400); sets.push('sell_threshold_pct = ?'); binds.push(v); }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields' }, 400);
  binds.push(id); await DB.prepare(`UPDATE spot_strategies SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true });
});
app.delete('/api/spot-strategies/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM spot_strategies WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});


app.get('/api/spot-positions', async (c) => {
  const DB = c.env['funbo-db']; const status = c.req.query('status'); const limit = parseInt(c.req.query('limit') || '100');
  let sql = 'SELECT * FROM spot_positions'; const binds: any[] = [];
  if (status) { sql += ' WHERE status = ?'; binds.push(status); }
  const limitNum = Math.min(isNaN(limit) ? 100 : limit, 500);
  return c.json((await DB.prepare(sql + ' ORDER BY bought_at DESC LIMIT ?').bind(...binds, limitNum).all()).results);
});


app.post('/api/solo-spot-strategies', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { chainId, tokenAddress, tradeAmount, minTradeAmount, maxTradeAmount } = (body as any) || {};
  if (!chainId || !tokenAddress) return c.json({ error: 'chainId, tokenAddress required' }, 400);
  const net = await DB.prepare('SELECT chain_id, explorer_url FROM networks WHERE chain_id = ? AND is_active = 1').bind(chainId).first() as any;
  if (!net) return c.json({ error: `Chain ${chainId} not configured or inactive` }, 400);
  await DB.prepare('INSERT INTO solo_spot_strategies (chain_id, token_address, trade_amount, min_trade_amount, max_trade_amount) VALUES (?, ?, ?, ?, ?)')
    .bind(chainId, tokenAddress, tradeAmount ?? '10', minTradeAmount ?? null, maxTradeAmount ?? null).run();
  return c.json({ success: true });
});
app.get('/api/solo-spot-strategies', async (c) => {
  const DB = c.env['funbo-db'];
  return c.json((await DB.prepare('SELECT * FROM solo_spot_strategies ORDER BY id').all()).results);
});
app.patch('/api/solo-spot-strategies/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const body = await safeJson(c); const DB = c.env['funbo-db'];
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['tokenAddress', 'tradeAmount', 'minTradeAmount', 'maxTradeAmount']) if (body[k] !== undefined) { const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); sets.push(`${col} = ?`); binds.push(body[k]); }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields' }, 400);
  binds.push(id); await DB.prepare(`UPDATE solo_spot_strategies SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true });
});
app.delete('/api/solo-spot-strategies/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM solo_spot_strategies WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});


app.get('/api/solo-spot-trades', async (c) => {
  const DB = c.env['funbo-db']; const strategyId = c.req.query('strategyId'); const limit = parseInt(c.req.query('limit') || '50');
  let sql = 'SELECT * FROM solo_spot_trades'; const binds: any[] = [];
  if (strategyId) { sql += ' WHERE strategy_id = ?'; binds.push(strategyId); }
  const limitNum = Math.min(isNaN(limit) ? 50 : limit, 200);
  return c.json((await DB.prepare(sql + ' ORDER BY created_at DESC LIMIT ?').bind(...binds, limitNum).all()).results);
});


app.post('/api/mm-lp-configs', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { chainId, tokenAddress, lpAddress, rebalanceThresholdPct } = (body as any) || {};
  if (!chainId || !tokenAddress) return c.json({ error: 'chainId, tokenAddress required' }, 400);
  const threshold = validateNumeric(rebalanceThresholdPct, 'rebalanceThresholdPct', 0);
  await DB.prepare('INSERT INTO mm_lp_configs (chain_id, token_address, lp_address, rebalance_threshold_pct) VALUES (?, ?, ?, ?)')
    .bind(chainId, tokenAddress, lpAddress || null, threshold ?? 5.0).run();
  return c.json({ success: true });
});

app.get('/api/mm-lp-configs', async (c) => {
  const DB = c.env['funbo-db']; const chainId = c.req.query('chainId');
  let sql = 'SELECT * FROM mm_lp_configs'; const binds: any[] = [];
  if (chainId) { sql += ' WHERE chain_id = ?'; binds.push(parseInt(chainId)); }
  return c.json((await DB.prepare(sql + ' ORDER BY token_address').bind(...binds).all()).results);
});

app.patch('/api/mm-lp-configs/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const body = await safeJson(c); const DB = c.env['funbo-db'];
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['tokenAddress', 'lpAddress']) if (body[k] !== undefined) { const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); sets.push(`${col} = ?`); binds.push(body[k]); }
  if (body.rebalanceThresholdPct !== undefined) { const v = validateNumeric(body.rebalanceThresholdPct, 'rebalanceThresholdPct', 0); if (v === null) return c.json({ error: 'Invalid threshold' }, 400); sets.push('rebalance_threshold_pct = ?'); binds.push(v); }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields' }, 400);
  sets.push('updated_at = CURRENT_TIMESTAMP');
  binds.push(id); await DB.prepare(`UPDATE mm_lp_configs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true });
});

app.delete('/api/mm-lp-configs/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM mm_lp_configs WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});


app.post('/api/ai', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { name, provider, model, apiKeyRef, params, priority, isActive } = (body as any) || {};
  if (!name || !provider || !model) return c.json({ error: 'name, provider, model required' }, 400);
  await DB.prepare('INSERT INTO ai_configs (name, provider, model, api_key_ref, params, priority, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(name, provider, model, apiKeyRef || null, params || null, priority ?? 0, isActive !== false ? 1 : 0).run();
  return c.json({ success: true });
});
app.get('/api/ai', async (c) => {
  const DB = c.env['funbo-db']; const provider = c.req.query('provider');
  let sql = 'SELECT * FROM ai_configs'; const binds: any[] = [];
  if (provider) { sql += ' WHERE provider = ?'; binds.push(provider); }
  return c.json((await DB.prepare(sql + ' ORDER BY priority').bind(...binds).all()).results);
});
app.patch('/api/ai/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const body = await safeJson(c); const DB = c.env['funbo-db'];
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const sets: string[] = []; const binds: any[] = [];
  for (const k of ['name', 'provider', 'model', 'apiKeyRef', 'params']) if (body[k] !== undefined) { const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); sets.push(`${col} = ?`); binds.push(body[k]); }
  if (body.priority !== undefined) { const v = validateNumeric(body.priority, 'priority', 0); if (v === null) return c.json({ error: 'Invalid priority' }, 400); sets.push('priority = ?'); binds.push(v); }
  if (body.isActive !== undefined) { sets.push('is_active = ?'); binds.push(body.isActive ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'No fields' }, 400);
  binds.push(id); await DB.prepare(`UPDATE ai_configs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ success: true });
});
app.delete('/api/ai/:id', async (c) => {
  const id = parseInt(c.req.param('id')); const DB = c.env['funbo-db'];
  await DB.prepare('DELETE FROM ai_configs WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

app.post('/api/ai/analyze', async (c) => {
  const DB = c.env['funbo-db']; const body = await safeJson(c);
  const { question, context } = (body || {}) as { question?: string; context?: Record<string, unknown> };
  if (!question) return c.json({ error: 'question required' }, 400);
  if (!c.env.AI) return c.json({ error: 'AI not configured on this worker' }, 501);
  const answer = await askAi(DB, c.env.AI, question, context);
  return c.json({ answer });
});


app.post('/api/quotas/adjust', async (c) => {
  const DB = c.env['funbo-db'];
  const rows = await DB.prepare('SELECT service, metric, limit_value, current_usage FROM service_quotas').all() as { results: any[] };
  let adjusted = 0;
  for (const row of rows.results) {
    const limit = Number(row.limit_value || 0);
    const used = Number(row.current_usage || 0);
    if (limit <= 0) continue;
    if (used / limit > 0.85 && limit < 100000) {
      await DB.prepare('UPDATE service_quotas SET limit_value = ? WHERE service = ? AND metric = ?').bind(Math.min(100000, Math.floor(limit * 1.5)), row.service, row.metric).run();
      adjusted++;
    } else if (used / limit < 0.3 && limit > 100) {
      await DB.prepare('UPDATE service_quotas SET limit_value = ? WHERE service = ? AND metric = ?').bind(Math.max(100, Math.floor(limit * 0.8)), row.service, row.metric).run();
      adjusted++;
    }
  }
  return c.json({ success: true, adjusted, message: `Adjusted ${adjusted} quotas` });
});


async function forwardRequest(c: any, targetPath: string, opts?: { body?: any }) {
  const baseUrl = (c.env.EXECUTION_WORKER_URL || '').replace(/\/$/, '');
  const svc = c.env.EXECUTION_WORKER;
  if (!baseUrl && !svc) return c.json({ error: 'EXECUTION_WORKER_URL not configured' }, 502);
  const headers: Record<string, string> = {};
  const apiKey = c.req.header('X-API-Key');
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';
  const fetchOpts: any = { method: 'POST', headers };
  if (opts?.body !== undefined) fetchOpts.body = JSON.stringify(opts.body);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = (svc ? 'http://internal' : baseUrl) + targetPath;
      const res = svc ? await svc.fetch(url, fetchOpts) : await fetch(url, fetchOpts);
      const text = await res.text();
      if (!text) continue;
      try { return c.json(JSON.parse(text), res.status as any); }
      catch { if (attempt === 0) continue; return c.json({ error: `Invalid JSON from execution worker`, raw: text.slice(0, 200) }, 502); }
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[forward] ${targetPath} attempt ${attempt} failed: ${msg}`);
      if (attempt === 1) return c.json({ error: `Execution worker unreachable: ${msg}` }, 502);
    }
  }
}

app.post('/api/bot/run', async (c) => {
  const body = await safeJson(c);
  return forwardRequest(c, '/api/bot/run', { body: body || {} });
});

app.post('/api/solo-spot/execute', async (c) => {
  return forwardRequest(c, '/api/solo-spot/execute');
});

app.post('/api/opportunities/scan', async (c) => {
  const body = await safeJson(c);
  return forwardRequest(c, '/api/opportunities/scan', { body: body || {} });
});

app.post('/api/spot-strategies/:id/execute', async (c) => {
  const id = c.req.param('id');
  return forwardRequest(c, `/api/spot-strategies/${id}/execute`);
});


async function forwardDiscovery(c: any, targetPath: string, opts?: { body?: any; method?: string }) {
  const baseUrl = (c.env.DISCOVERY_WORKER_URL || '').replace(/\/$/, '');
  const svc = c.env.DISCOVERY_WORKER;
  if (!baseUrl && !svc) return c.json({ error: 'DISCOVERY_WORKER_URL not configured' }, 502);
  const headers: Record<string, string> = {};
  const apiKey = c.req.header('X-API-Key');
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';
  const fetchOpts: any = { method: opts?.method || 'POST', headers };
  if (opts?.body !== undefined) fetchOpts.body = JSON.stringify(opts.body);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = (svc ? 'http://internal' : baseUrl) + targetPath;
      const res = svc ? await svc.fetch(url, fetchOpts) : await fetch(url, fetchOpts);
      const text = await res.text();
      if (!text) continue;
      try { return c.json(JSON.parse(text), res.status as any); }
      catch { if (attempt === 0) continue; return c.json({ error: `Invalid JSON from discovery worker`, raw: text.slice(0, 200) }, 502); }
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[forward] ${targetPath} attempt ${attempt} failed: ${msg}`);
      if (attempt === 1) return c.json({ error: `Discovery worker unreachable: ${msg}` }, 502);
    }
  }
}

app.post('/api/discovery/run', async (c) => {
  const body = await safeJson(c);
  return forwardDiscovery(c, '/api/discovery/run', { body: body || {} });
});

app.get('/api/discovery-pools', async (c) => {
  return forwardDiscovery(c, '/api/discovery-pools', { method: 'GET' });
});

app.get('/api/discovery-pools/:id', async (c) => {
  const id = c.req.param('id');
  return forwardDiscovery(c, `/api/discovery-pools/${id}`, { method: 'GET' });
});


app.get('/api/bot/status', async (c) => {
  const DB = c.env['funbo-db'];
  const autoScanRes = await DB.prepare('SELECT value FROM config WHERE key = "auto_scan_enabled"').first() as { value: string } | null;
  const lastScanRes = await DB.prepare('SELECT value FROM config WHERE key = "last_auto_scan"').first() as { value: string } | null;
  const lastExecRes = await DB.prepare('SELECT value FROM config WHERE key = "last_auto_execute"').first() as { value: string } | null;
  return c.json({
    auto_scan_enabled: autoScanRes?.value === 'true',
    last_auto_scan: lastScanRes?.value ?? null,
    last_auto_execute: lastExecRes?.value ?? null,
  });
});


app.get('/api/nodes/recommended-pool', async (c) => {
  const chainId = parseInt(c.req.query('chainId') || '');
  if (!chainId) return c.json({ error: 'chainId required' }, 400);
  const pool = DEFAULT_POOLS[chainId];
  return c.json({ chainId, recommended: pool ?? [] });
});


app.post('/api/errors/log', async (c) => {
  const DB = c.env['funbo-db'];
  const body = await safeJson(c) || {};
  const { source, level, message, details, chain_id, worker } = body as any;
  if (!source || !message) return c.json({ error: 'source and message required' }, 400);
  await DB.prepare('INSERT INTO error_logs (source, level, message, details, chain_id, worker) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(source, level || 'error', message, details ? JSON.stringify(details) : null, chain_id || null, worker || null).run();
  return c.json({ success: true });
});

app.get('/api/errors/logs', async (c) => {
  const DB = c.env['funbo-db'];
  const source = c.req.query('source');
  const level = c.req.query('level');
  const limit = parseInt(c.req.query('limit') || '100');
  let sql = 'SELECT * FROM error_logs WHERE 1=1';
  const binds: any[] = [];
  if (source) { sql += ' AND source = ?'; binds.push(source); }
  if (level) { sql += ' AND level = ?'; binds.push(level); }
  const limitNum = Math.min(isNaN(limit) ? 100 : limit, 500);
  return c.json((await DB.prepare(sql + ' ORDER BY created_at DESC LIMIT ?').bind(...binds, limitNum).all()).results);
});

export default { fetch: app.fetch };

