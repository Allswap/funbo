import { Hono } from 'hono';
import { initDB } from './db';
import { sendNotification } from './notifier';
import { runAiAdvisor } from './ai-advisor';
import { runMainAi } from '../../shared/ai-advisor';
import { getQuotaUsage, getQuotaUsageAll, autoAdjustQuotas, resetUsageIfWindowExpired, seedDefaultQuotas, resetAllUsageIfWindowExpired } from './rpc-pool';

async function safeJson(c: any): Promise<Record<string, unknown> | null> {
  try { return await c.req.json(); } catch { return null; }
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN || '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (c.req.method === 'OPTIONS') return c.newResponse(null, { status: 204 });
  await initDB(c.env);
  return next();
});

app.get('/api/health', (c) => c.json({ status: 'ok', worker: 'funbo-analytics' }));

app.get('/api/analytics/pnl', async (c) => {
  const DB = c.env['funbo-db'];
  const daysParam = parseInt(c.req.query("days") || '7');
  const days = isNaN(daysParam) || daysParam <= 0 ? 7 : Math.min(daysParam, 90);

  const pnl = await DB.prepare(`
    SELECT * FROM daily_pnl 
    WHERE date >= date('now', '-' || ? || ' days')
    ORDER BY date DESC
  `).bind(days).all();
  
  return c.json(pnl.results);
});

app.get('/api/analytics/stats', async (c) => {
  const DB = c.env['funbo-db'];
  
  const [tradesRes, oppsRes] = await Promise.all([
    DB.prepare("SELECT COUNT(*), SUM(profit_pct), AVG(gas_spent) FROM trades WHERE status = 'success'").first(),
    DB.prepare("SELECT COUNT(*) FROM opportunities WHERE status = 'pending'").first()
  ]);
  
  return c.json({
    totalTrades: tradesRes?.['COUNT(*)'] || 0,
    totalProfit: tradesRes?.['SUM(profit_pct)'] || 0,
    avgGas: tradesRes?.['AVG(gas_spent)'] || 0,
    pendingOpps: oppsRes?.['COUNT(*)'] || 0
  });
});

app.get('/api/analytics/success-rate', async (c) => {
  const DB = c.env['funbo-db'];
  const chainId = c.req.query("chainId");
  
  let sql = 'SELECT status, COUNT(*) as count FROM trades';
  const binds: any[] = [];
  if (chainId) {
    const parsed = parseInt(chainId);
    if (!isNaN(parsed)) {
      sql += ' WHERE chain_id = ?';
      binds.push(parsed);
    }
  }
  sql += ' GROUP BY status';
  
  const results = await DB.prepare(sql).bind(...binds).all();
  return c.json(results.results);
});

app.post('/api/notify', async (c) => {
  const body = await safeJson(c);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const { urgency, subject, body: msgBody, fields } = body as { urgency?: string; subject?: string; body?: string; fields?: Record<string, string> };
  if (!urgency || !subject) return c.json({ error: 'urgency and subject are required' }, 400);
  const result = await sendNotification(c.env, urgency as any, subject, msgBody || '', fields);
  return c.json(result);
});

app.post('/api/notify/test', async (c) => {
  const DB = c.env['funbo-db'];
  
  const webhookRes = await DB.prepare('SELECT value FROM config WHERE key = "discord_webhook_url"').first();
  const webhookUrl = webhookRes?.value;
  if (!webhookUrl) {
    return c.json({ error: "Discord webhook not configured" }, 400);
  }
  
  try {
    const res = await (fetch as any)(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🧪 Test notification from funbo-analytics` })
    });
    return c.json({ success: res.ok });
  } catch {
    return c.json({ success: false });
  }
});

app.post('/api/analytics/ai-suggest', async (c) => {
  try {
    const suggestions = await runAiAdvisor(c.env);
    return c.json(suggestions);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/analytics/ai-main', async (c) => {
  try {
    const inserted = await runMainAi(c.env['funbo-db'], c.env.AI);
    return c.json({ success: true, strategiesCreated: inserted });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/trades', async (c) => {
  const DB = c.env['funbo-db'];
  const chainId = c.req.query("chainId");
  const limit = c.req.query("limit") || 100;

  let sql = 'SELECT * FROM trades';
  const binds: any[] = [];

  if (chainId) {
    const parsed = parseInt(chainId);
    if (!isNaN(parsed)) {
      sql += ' WHERE chain_id = ?';
      binds.push(parsed);
    }
  }

  const limitNum = parseInt(String(limit));
  sql += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(isNaN(limitNum) ? 100 : limitNum);

  const trades = await DB.prepare(sql).bind(...binds).all();
  return c.json(trades.results);
});

app.get('/api/quotas', async (c) => {
  const service = c.req.query('service');
  const metric = c.req.query('metric');
  if (service && metric) {
    const usage = await getQuotaUsage(c.env, service, metric);
    return usage ? c.json(usage) : c.json({ error: 'Not found' }, 404);
  }
  const rows = await c.env['funbo-db'].prepare('SELECT service, metric, limit_value, current_usage, window_seconds FROM service_quotas').all();
  return c.json(rows.results);
});

app.get('/api/quotas/all', async (c) => {
  const data = await getQuotaUsageAll(c.env);
  return c.json(data);
});

app.post('/api/quotas/adjust', async (c) => {
  await autoAdjustQuotas(c.env);
  const data = await getQuotaUsageAll(c.env);
  return c.json({ success: true, quotas: data });
});

app.post('/api/quotas/reset', async (c) => {
  const body = await safeJson(c);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const { service, metric } = body as { service?: string; metric?: string };
  if (!service || !metric) return c.json({ error: 'service and metric required' }, 400);
  await resetUsageIfWindowExpired(c.env, service, metric);
  return c.json({ success: true });
});

app.post('/api/quotas/seed', async (c) => {
  const body = await safeJson(c);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const { provider } = body as { provider?: string };
  await seedDefaultQuotas(c.env, provider || 'default-rpc');
  return c.json({ success: true });
});

app.get('/api/usage', async (c) => {
  await resetAllUsageIfWindowExpired(c.env);
  await autoAdjustQuotas(c.env);
  const data = await getQuotaUsageAll(c.env);
  return c.json(data);
});

app.post('/api/cron/cleanup', async (c) => {
  const env = c.env;
  const DB = env['funbo-db'];
  const body = await c.req.json().catch(() => ({}));
  const oppDays = body.oppDays ?? 30;
  const tradeDays = body.tradeDays ?? 90;
  const pnlDays = body.pnlDays ?? 180;
  const positionDays = body.positionDays ?? 90;
  const soloTradeDays = body.soloTradeDays ?? 90;
  const mmConfigDays = body.mmConfigDays ?? 180;

  const deletedOpps = await DB.prepare(
    `DELETE FROM opportunities 
     WHERE status IN ('skipped', 'failed', 'executed') 
     AND created_at < date('now', '-' || ? || ' days')`
  ).bind(oppDays).run();

  const deletedTrades = await DB.prepare(
    `DELETE FROM bot_transactions 
     WHERE created_at < date('now', '-' || ? || ' days')`
  ).bind(tradeDays).run();

  const deletedPnl = await DB.prepare(
    `DELETE FROM daily_pnl 
     WHERE date < date('now', '-' || ? || ' days')`
  ).bind(pnlDays).run();

  const deletedPositions = await DB.prepare(
    `DELETE FROM spot_positions 
     WHERE status = 'closed' AND closed_at < date('now', '-' || ? || ' days')`
  ).bind(positionDays).run();

  const deletedSoloTrades = await DB.prepare(
    `DELETE FROM solo_spot_trades 
     WHERE created_at < date('now', '-' || ? || ' days')`
  ).bind(soloTradeDays).run();

  const deletedMmConfigs = await DB.prepare(
    `DELETE FROM mm_lp_configs 
     WHERE is_active = 0 AND updated_at < date('now', '-' || ? || ' days')`
  ).bind(mmConfigDays).run();

  console.log(`[cleanup] deleted: opps=${deletedOpps.changes}, trades=${deletedTrades.changes}, pnl=${deletedPnl.changes}, positions=${deletedPositions.changes}, soloTrades=${deletedSoloTrades.changes}, mmConfigs=${deletedMmConfigs.changes}`);

  return c.json({ 
    success: true, 
    deleted: { 
      opportunities: deletedOpps.changes, 
      transactions: deletedTrades.changes, 
      pnl: deletedPnl.changes,
      positions: deletedPositions.changes,
      soloTrades: deletedSoloTrades.changes,
      mmConfigs: deletedMmConfigs.changes
    }
  });
});

app.post('/api/cron/analytics', async (c) => {
  const env = c.env;
  const DB = env['funbo-db'];

  await resetAllUsageIfWindowExpired(env);
  await autoAdjustQuotas(env);

  const stats = await DB.prepare("SELECT COUNT(*) as count, SUM(profit_pct) as profit FROM trades WHERE date(created_at) = date('now')").first();
  console.log(`[analytics] today: ${stats?.count || 0} trades, ${stats?.profit || 0} profit`);

  try {
    const suggestions = await runAiAdvisor(env);
    if (suggestions.length > 0) {
      console.log(`[analytics] AI suggestions: ${suggestions.length}`);
      await sendNotification(env, 'average', `AI Advisor: ${suggestions.length} suggestions`, suggestions.map((s: any) => `${s.target}: ${s.currentValue} → ${s.suggestedValue}`).join('\n'));
    }
  } catch (e) {
    console.error('[analytics] AI advisor failed:', (e as Error).message);
  }

  if (env.AI) {
    try {
      const inserted = await runMainAi(DB, env.AI);
      if (inserted > 0) {
        console.log(`[analytics] Main AI created ${inserted} new strategies`);
        await sendNotification(env, 'average', `Main AI: ${inserted} new strategies`, `Created ${inserted} new spot strategies from aggregated analysis`);
      }
    } catch (e) {
      console.error('[analytics] Main AI failed:', (e as Error).message);
    }
  }

  return c.json({ success: true, message: 'Analytics cron completed' });
});

async function scheduledReport(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  const DB = env['funbo-db'];

  await resetAllUsageIfWindowExpired(env);
  await autoAdjustQuotas(env);

  ctx.waitUntil((async () => {
    const stats = await DB.prepare("SELECT COUNT(*) as count, SUM(profit_pct) as profit FROM trades WHERE date(created_at) = date('now')").first();
    console.log(`[analytics] today: ${stats?.count || 0} trades, ${stats?.profit || 0} profit`);

    try {
      const suggestions = await runAiAdvisor(env);
      if (suggestions.length > 0) {
        console.log(`[analytics] AI suggestions: ${suggestions.length}`);
        await sendNotification(env, 'average', `AI Advisor: ${suggestions.length} suggestions`, suggestions.map((s: any) => `${s.target}: ${s.currentValue} → ${s.suggestedValue}`).join('\n'));
      }
    } catch (e) {
      console.error('[analytics] AI advisor failed:', (e as Error).message);
    }

    if (env.AI) {
      try {
        const inserted = await runMainAi(DB, env.AI);
        if (inserted > 0) {
          console.log(`[analytics] Main AI created ${inserted} new strategies`);
          await sendNotification(env, 'average', `Main AI: ${inserted} new strategies`, `Created ${inserted} new spot strategies from aggregated analysis`);
        }
      } catch (e) {
        console.error('[analytics] Main AI failed:', (e as Error).message);
      }
    }
  })());
}

export default { fetch: app.fetch, scheduled: scheduledReport };
