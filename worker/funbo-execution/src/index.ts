import { Hono } from 'hono';
import { initDB } from './db';
import { executeOpportunity, executeSpotBuy, executeSpotSell, executeSoloSpotFromOpp, executeMMRebalance, executeTriangularArb, TradeResult } from './bot-engine';
import { ethers } from 'ethers';
import { logScanResult, logTradeReceipt } from './bot-engine';
import { encodeV3Path, getWorkingRpcUrl, logError } from '../../shared/rpc-pool';
import { rawQuoteRoute, rawQuoteRouteAmount, rawEthCall, getTokenDecimals, V2_GET_AMOUNTS_OUT, V3_QUOTE_EXACT_INPUT, V3_FEE_TIERS, DEFAULT_AMOUNT_IN } from '../../shared/quotes';

async function hashApiKey(apiKey: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function safeJson(c: any): Promise<Record<string, unknown> | null> {
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

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN || '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (c.req.method === 'OPTIONS') return c.newResponse(null, { status: 204 });

  const path = c.req.path.replace(/\/+/g, '/');
  const publicPaths = ['/api/health', '/api/cron/execute', '/api/cron/scan-and-execute'];
  if (publicPaths.includes(path)) return next();

  const apiKey = c.req.header('X-API-Key');
  if (!apiKey) return c.json({ error: 'Missing X-API-Key' }, 401);
  const DB = c.env['funbo-db'];
  const keyHash = await hashApiKey(apiKey);
  const validKey = await DB.prepare('SELECT id FROM api_keys WHERE key_hash = ? AND is_active = 1').bind(keyHash).first();
  if (!validKey) return c.json({ error: 'Invalid or expired API Key' }, 403);
  return next();
});

app.get('/api/health', (c) => c.json({ status: 'ok', worker: 'funbo-execution' }));

app.post('/api/bot/run', async (c) => {
  const result = await executePendingOpportunities(c.env);
  return c.json(result);
});

app.post('/api/cron/execute', async (c) => {
  if (!(await dedupCronRun(c.env['funbo-db'], 'execute', 15))) return c.json({ success: true, message: 'Skipped: already ran recently', triggered: 'external' });
  c.executionCtx.waitUntil((async () => {
    const result = await executePendingOpportunities(c.env);
    console.log(`[executor] cron execute: ${result.executed} executed`);
  })());
  return c.json({ success: true, message: 'Execution triggered', triggered: 'external' });
});

async function scanAndExecuteChain(env: Env, chainId: number): Promise<{ inserted: number; executed: number }> {
  const DB = env['funbo-db'];
  const network = await DB.prepare('SELECT * FROM networks WHERE is_active = 1 AND chain_id = ?').bind(chainId).first() as { rpc_url: string } | null;
  if (!network?.rpc_url) return { inserted: 0, executed: 0 };
  const minProfitRow = await DB.prepare('SELECT value FROM config WHERE key = "min_profit_pct"').first() as { value: string } | null;
  const minProfitPct = minProfitRow ? parseFloat(minProfitRow.value) : 0.5;
  const feeTierRow = await DB.prepare('SELECT value FROM config WHERE key = "default_fee_tier"').first() as { value: string } | null;
  const feeTier = feeTierRow ? parseInt(feeTierRow.value) : 1000;
  const tradeAmountRes = await DB.prepare('SELECT value FROM config WHERE key = "trade_amount"').first() as { value: string } | null;
  const tradeAmount = tradeAmountRes?.value || '0.1';
  const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(chainId).all() as { results: any[] };
  const pairs = await DB.prepare('SELECT * FROM token_pairs WHERE chain_id = ? AND is_active = 1').bind(chainId).all() as { results: any[] };
  const _rpcUrl = await getWorkingRpcUrl(env, chainId, network.rpc_url);
  if (!_rpcUrl) return { inserted: 0, executed: 0 };
  const maxPairsPerRun = 4;
  const maxRouterPairsPerPair = 5;
  let inserted = 0;
  if (routers.results.length >= 2 && pairs.results.length > 0) {
    const validRouters = routers.results.filter((r: any) => r.address && (r.version === 'v3' ? r.quoter_address : true));
    for (let pIdx = 0; pIdx < Math.min(pairs.results.length, maxPairsPerRun); pIdx++) {
      const pair = pairs.results[pIdx];
      let routerPairsDone = 0;
      for (let i = 0; i < validRouters.length && routerPairsDone < maxRouterPairsPerPair; i++) {
        for (let j = i + 1; j < validRouters.length && routerPairsDone < maxRouterPairsPerPair; j++) {
          const [quoteA, quoteB] = await Promise.all([
            rawQuoteRoute(_rpcUrl, pair.token_a, pair.token_b, validRouters[i], feeTier, env),
            rawQuoteRoute(_rpcUrl, pair.token_a, pair.token_b, validRouters[j], feeTier, env),
          ]);
          if (!quoteA || !quoteB || quoteA === 0n || quoteB === 0n) continue;
          const bestOut = quoteA > quoteB ? quoteA : quoteB;
          const worstOut = quoteA > quoteB ? quoteB : quoteA;
          if (worstOut === 0n) continue;
          const profitBps = Number((bestOut - worstOut) * 10000n / worstOut) / 100;
          if (profitBps < minProfitPct) continue;
          const buyRouter = quoteA > quoteB ? validRouters[i] : validRouters[j];
          const sellRouter = quoteA > quoteB ? validRouters[j] : validRouters[i];
          await DB.prepare('INSERT INTO opportunities (chain_id, router_a, router_b, token_a, token_b, amount_in, profit_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")')
            .bind(chainId, buyRouter.address, sellRouter.address, pair.token_a, pair.token_b, tradeAmount, profitBps).run();
          inserted++;
          routerPairsDone++;
        }
      }
    }
  }
  await DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .bind('last_auto_scan', new Date().toISOString(), new Date().toISOString()).run();
  if (inserted > 0) {
    const opportunities = await DB.prepare('SELECT * FROM opportunities WHERE chain_id = ? AND created_at >= datetime("now", "-5 minutes") AND profit_pct >= ? ORDER BY created_at DESC')
      .bind(chainId, minProfitPct).all();
    await logScanResult(env, chainId, 'cross-dex', opportunities.results || []);
  }
  const execResult = await executePendingOpportunities(env);
  console.log(`[executor] scan-and-execute: chain=${chainId} inserted=${inserted} executed=${execResult.executed}`);
  return { inserted, executed: execResult.executed };
}

app.post('/api/cron/scan-and-execute', async (c) => {
  const body = await safeJson(c);
  const { chainId } = body as { chainId?: number } || {};
  if (!chainId) return c.json({ error: 'chainId required' }, 400);
  if (!(await dedupCronRun(c.env['funbo-db'], 'scan_execute', 20))) return c.json({ success: true, message: 'Skipped: already ran recently' });
  c.executionCtx.waitUntil(scanAndExecuteChain(c.env, chainId));
  return c.json({ success: true, message: 'Scan + execution triggered' });
});

app.post('/api/spot-strategies/:id/execute', async (c) => {
  const id = parseInt(c.req.param('id'));
  const DB = c.env['funbo-db'];
  const strat = await DB.prepare('SELECT * FROM spot_strategies WHERE id = ?').bind(id).first() as any;
  if (!strat) return c.json({ error: 'Strategy not found' }, 404);
  const net = await DB.prepare('SELECT * FROM networks WHERE chain_id = ? AND is_active = 1').bind(strat.chain_id).first() as any;
  if (!net) return c.json({ error: 'Network not configured for this strategy' }, 400);
  const wallets = await DB.prepare('SELECT * FROM wallets WHERE is_active = 1 AND chain_id = ? ORDER BY id LIMIT 1').bind(strat.chain_id).all() as { results: any[] };
  if (wallets.results.length === 0) return c.json({ error: 'No active wallet for this chain' }, 400);

  const openPos = await DB.prepare('SELECT * FROM spot_positions WHERE spot_strategy_id = ? AND status = "open" ORDER BY bought_at DESC LIMIT 1').bind(id).first() as any;
  let result;
  if (openPos) {
    result = await executeSpotSell(c.env, net, openPos, DB);
  } else {
    result = await executeSpotBuy(c.env, net, strat, wallets.results[0].address, DB);
  }
  return c.json(result);
});

app.post('/api/solo-spot/execute', async (c) => {
  const DB = c.env['funbo-db'];
  const pending = await DB.prepare('SELECT * FROM opportunities WHERE router_b = "solo_spot" AND status = "pending" ORDER BY profit_pct DESC').all() as { results: any[] };
  if (pending.results.length === 0) return c.json({ executed: 0, message: 'No pending solo-spot opportunities' });
  const networks = await DB.prepare('SELECT * FROM networks WHERE is_active = 1').all() as { results: any[] };
  const networkMap = Object.fromEntries(networks.results.map((n: any) => [n.chain_id, n]));
  const defaultFeeTier = parseInt((await DB.prepare('SELECT value FROM config WHERE key = "default_fee_tier"').first() as { value: string } | null)?.value || '3000');
  let executed = 0;
  for (const opp of pending.results) {
    const net = networkMap[opp.chain_id];
    if (!net) { await DB.prepare('UPDATE opportunities SET status = "skipped" WHERE id = ?').bind(opp.id).run(); continue; }
    const wallets = await DB.prepare('SELECT * FROM wallets WHERE is_active = 1 AND chain_id = ?').bind(opp.chain_id).all() as { results: any[] };
    if (wallets.results.length === 0) { await DB.prepare('UPDATE opportunities SET status = "skipped" WHERE id = ?').bind(opp.id).run(); continue; }
    const result = await executeSoloSpotFromOpp(c.env, net, opp, wallets.results[0].address, DB, defaultFeeTier);
    await DB.prepare('UPDATE opportunities SET status = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(result.status === 'success' ? 'executed' : 'skipped', opp.id).run();
    if (result.status === 'success') executed++;
  }
  return c.json({ executed, message: `Executed ${executed} solo-spot trades` });
});

app.get('/api/bot/status', async (c) => {
  const DB = c.env['funbo-db'];
  const autoScanRes = await DB.prepare('SELECT value FROM config WHERE key = "auto_scan_enabled"').first() as { value: string } | null;
  const lastScanRes = await DB.prepare('SELECT value FROM config WHERE key = "last_auto_scan"').first() as { value: string } | null;
  const lastExecRes = await DB.prepare('SELECT value FROM config WHERE key = "last_auto_execute"').first() as { value: string } | null;
  return c.json({ auto_scan_enabled: autoScanRes ? autoScanRes.value === 'true' : false, last_auto_scan: lastScanRes ? lastScanRes.value : null, last_auto_execute: lastExecRes ? lastExecRes.value : null });
});

async function executePendingOpportunities(env: Env): Promise<any> {
  const DB = env['funbo-db'];
  await DB.prepare("UPDATE opportunities SET status = 'skipped', error_msg = 'Stale: pending >1h' WHERE status = 'pending' AND created_at < datetime('now', '-1 hour')").run();
  const pending = await DB.prepare('SELECT * FROM opportunities WHERE status = "pending" ORDER BY profit_pct DESC LIMIT 2').all() as { results: any[] };
  console.log(`[executor] found ${pending.results.length} pending opps`);
  if (pending.results.length === 0) return { success: true, message: 'No pending opportunities.', executed: 0 };
  for (const opp of pending.results) {
    console.log(`[executor] pending opp #${opp.id}: chain=${opp.chain_id} routerA=${(opp.router_a || '').slice(0,10)} routerB=${(opp.router_b || '').slice(0,10)}`);
  }
  const networks = await DB.prepare('SELECT * FROM networks WHERE is_active = 1').all() as { results: any[] };
  const networkMap = Object.fromEntries(networks.results.map((n: any) => [n.chain_id, n]));
  const defaultFeeTier = parseInt((await DB.prepare('SELECT value FROM config WHERE key = "default_fee_tier"').first() as { value: string } | null)?.value || '3000');

  async function executeSingleOpp(opp: any): Promise<boolean> {
    try {
      const net = networkMap[opp.chain_id];
      console.log(`[executor] executeSingleOpp #${opp.id}: net=${!!net} chain_id=${opp.chain_id}`);
      if (!net) { console.log(`[executor] opp #${opp.id}: network not found`); await DB.prepare('UPDATE opportunities SET status = "skipped" WHERE id = ?').bind(opp.id).run(); return false; }
      const wallets = await DB.prepare('SELECT * FROM wallets WHERE is_active = 1 AND chain_id = ?').bind(opp.chain_id).all() as { results: any[] };
      console.log(`[executor] opp #${opp.id}: wallets with is_active=1: ${wallets.results.length}`);
      if (wallets.results.length === 0) {
        const allWallets = await DB.prepare('SELECT * FROM wallets WHERE chain_id = ? LIMIT 1').bind(opp.chain_id).all() as { results: any[] };
        console.log(`[executor] opp #${opp.id}: wallets without is_active filter: ${allWallets.results.length}`);
        if (allWallets.results.length === 0) { console.log('[executor] NO WALLETS FOUND'); await DB.prepare('UPDATE opportunities SET status = "skipped", error_msg = "No wallets found" WHERE id = ?').bind(opp.id).run(); return false; }
        wallets.results = allWallets.results;
      }
      const routers = await DB.prepare('SELECT * FROM dex_routers WHERE chain_id = ? AND is_active = 1').bind(opp.chain_id).all() as { results: any[] };
      const routerA = routers.results.find((r: any) => r.address?.toLowerCase() === (opp.router_a || '').toLowerCase());

      if (opp.router_b === 'solo_spot') {
        const result = await executeSoloSpotFromOpp(env, net, opp, wallets.results[0].address, DB, defaultFeeTier);
        await DB.prepare('UPDATE opportunities SET status = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(result.status === 'success' ? 'executed' : 'skipped', opp.id).run();
        return result.status === 'success';
      }

      if (opp.router_b === 'mm_rebalance') {
        const result = await executeMMRebalance(env, net, opp, wallets.results[0].address, DB, defaultFeeTier);
        await DB.prepare('UPDATE opportunities SET status = ?, error_msg = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(result.status === 'success' ? 'executed' : 'skipped', result.errorMsg || null, opp.id).run();
        return result.status === 'success';
      }

      if (opp.router_b === 'spot_buy' || opp.router_b === 'spot_sell') {
        const stratId = parseInt(opp.amount_in);
        if (opp.router_b === 'spot_buy') {
          const strat = await DB.prepare('SELECT * FROM spot_strategies WHERE id = ? AND is_active = 1').bind(stratId).first() as any;
          if (!strat) { await DB.prepare('UPDATE opportunities SET status = "skipped", error_msg = ? WHERE id = ?').bind('Strategy not found or inactive', opp.id).run(); return false; }
          const result = await executeSpotBuy(env, net, strat, wallets.results[0].address, DB);
          await DB.prepare('UPDATE opportunities SET status = ?, error_msg = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(result.status === 'success' ? 'executed' : 'skipped', result.errorMsg || null, opp.id).run();
          return result.status === 'success';
        } else {
          const position = await DB.prepare('SELECT * FROM spot_positions WHERE id = ? AND status = "open"').bind(stratId).first() as any;
          if (!position) { await DB.prepare('UPDATE opportunities SET status = "skipped", error_msg = ? WHERE id = ?').bind('Position not found or already closed', opp.id).run(); return false; }
          const result = await executeSpotSell(env, net, position, DB);
          await DB.prepare('UPDATE opportunities SET status = ?, error_msg = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(result.status === 'success' ? 'executed' : 'skipped', result.errorMsg || null, opp.id).run();
          return result.status === 'success';
        }
      }

      if (opp.router_a && opp.router_a === opp.router_b) {
        const triResult = await executeTriangularArb(env, net, opp, wallets.results[0].address, DB, defaultFeeTier);
        await DB.prepare('UPDATE opportunities SET status = ?, error_msg = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(triResult.status === 'success' ? 'executed' : 'skipped', triResult.errorMsg || null, opp.id).run();
        return triResult.status === 'success';
      }

      const routerB = routers.results.find((r: any) => r.address?.toLowerCase() === (opp.router_b || '').toLowerCase());
      if (!routerA || !routerB) { await DB.prepare('UPDATE opportunities SET status = "skipped", error_msg = ? WHERE id = ?').bind('Router not found in DB', opp.id).run(); return false; }
      let result: TradeResult;
      try {
        result = await executeOpportunity(env, net, opp, wallets.results[0].address, DB, defaultFeeTier);
      } catch (err: any) {
        console.log(`[executor] opp #${opp.id} execution error: ${err.message}`);
        await DB.prepare('UPDATE opportunities SET status = "failed", error_msg = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(err.message || 'Execution error', opp.id).run();
        return false;
      }
      await DB.prepare('UPDATE opportunities SET status = ?, error_msg = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(result.status === 'success' ? 'executed' : 'skipped', result.errorMsg || null, opp.id).run();
      return result.status === 'success';
    } catch (err: any) {
      console.log(`[executor] opp #${opp.id} unhandled error: ${err.message}`);
      await DB.prepare('UPDATE opportunities SET status = "failed", error_msg = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(err.message || 'Unhandled execution error', opp.id).run();
      return false;
    }
  }

  const cpuStart = Date.now();
  const MAX_WALL_MS = 45000;
  let executed = 0;
  for (let i = 0; i < pending.results.length; i += 1) {
    if (Date.now() - cpuStart > MAX_WALL_MS) {
      console.log(`[executor] wall time exceeded, stopping after ${executed} executed`);
      break;
    }
    const r = await executeSingleOpp(pending.results[i]);
    if (r) executed++;
  }
  return { success: true, executed, message: `Executed ${executed} opportunities` };
}

export async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  await initDB(env);
  ctx.waitUntil((async () => {
    try {
      if (event.cron === '*/20 * * * *') {
        if (!(await dedupCronRun(env['funbo-db'], 'scan_execute', 20))) return;
        const DB = env['funbo-db'];
        const networks = await DB.prepare('SELECT * FROM networks WHERE is_active = 1').all() as { results: any[] };
        for (const net of networks.results) {
          try {
            const result = await scanAndExecuteChain(env, net.chain_id);
            console.log(`[scanner] chain ${net.chain_id} done: inserted=${result.inserted} executed=${result.executed}`);
          } catch (e) {
            console.error(`[scanner] chain ${net.chain_id} scan failed:`, e);
            await logError(env, 'funbo-execution', `chain ${net.chain_id} scan failed: ${(e as Error).message}`, { level: 'error', details: { cron: '*/20', chain_id: net.chain_id }, worker: 'funbo-execution' });
          }
        }
      } else if (event.cron === '*/15 * * * *') {
        if (!(await dedupCronRun(env['funbo-db'], 'execute', 15))) return;
        const execResult = await executePendingOpportunities(env);
        console.log(`[executor] auto-executed ${execResult.executed} opportunities`);
      }
    } catch (e) {
      console.error('[executor] scheduled failed:', e);
      await logError(env, 'funbo-execution', `scheduled failed: ${(e as Error).message}`, { level: 'error', details: { cron: event.cron }, worker: 'funbo-execution' });
    }
  })());
}

export default { fetch: app.fetch, scheduled };
