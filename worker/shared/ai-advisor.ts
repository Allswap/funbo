export async function aiModel(db: D1Database): Promise<string> {
  const cfg = await db.prepare(
    'SELECT model FROM ai_configs WHERE is_active = 1 ORDER BY priority DESC LIMIT 1'
  ).first() as { model: string } | null;
  return cfg?.model ?? '@cf/meta/llama-3-8b-instruct';
}

export async function runAiPrompt(ai: any, model: string, prompt: string, maxTokens = 1024): Promise<string> {
  try {
    const response = await ai.run(model, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    });
    return (response as any).response || '';
  } catch {
    return '';
  }
}

export async function runAiAdvisorBase(
  db: D1Database,
  ai: any,
  prompt: string,
): Promise<Record<string, any>[]> {
  try {
    const model = await aiModel(db);
    const text = await runAiPrompt(ai, model, prompt);
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let suggestions: Record<string, any>[];
    try { suggestions = JSON.parse(match[0]); } catch { return []; }

    for (const s of suggestions) {
      await db.prepare(
        'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
      ).bind(`ai_suggest_${s.target}`, JSON.stringify(s), JSON.stringify(s)).run();
    }
    return suggestions;
  } catch {
    return [];
  }
}

export async function runMainAi(db: D1Database, ai: any): Promise<number> {
  if (!ai) return 0;
  const model = await aiModel(db);

  let suggestions: { results: { key: string; value: string }[] } = { results: [] };
  let discoveries: { results: { key: string; value: string }[] } = { results: [] };
  let execScores: { results: { key: string; value: string }[] } = { results: [] };
  let trades: { results: any[] } = { results: [] };
  let opportunities: { results: any[] } = { results: [] };
  let activeStrats: { results: any[] } = { results: [] };
  let networks: { results: { chain_id: number; name: string }[] } = { results: [] };

  try {
    [suggestions, discoveries, execScores, trades, opportunities, activeStrats, networks] = await Promise.all([
      db.prepare("SELECT key, value FROM config WHERE key LIKE 'ai_suggest_%'").all() as Promise<{ results: { key: string; value: string }[] }>,
      db.prepare("SELECT key, value FROM config WHERE key LIKE 'ai_discovery_%'").all() as Promise<{ results: { key: string; value: string }[] }>,
      db.prepare("SELECT key, value FROM config WHERE key LIKE 'ai_execution_%' ORDER BY key DESC LIMIT 50").all() as Promise<{ results: { key: string; value: string }[] }>,
      db.prepare("SELECT * FROM trades WHERE created_at > datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 100").all() as Promise<{ results: any[] }>,
      db.prepare("SELECT * FROM opportunities WHERE status = 'pending' AND created_at > datetime('now', '-7 days') LIMIT 50").all() as Promise<{ results: any[] }>,
      db.prepare('SELECT * FROM spot_strategies WHERE is_active = 1').all() as Promise<{ results: any[] }>,
      db.prepare('SELECT chain_id, name FROM networks WHERE is_active = 1').all() as Promise<{ results: { chain_id: number; name: string }[] }>,
    ]);
  } catch (e: any) {
    return 0;
  }

  const prompt = `You are a strategy architect for an EVM arbitrage bot. Your job is to design new spot trading strategies based on real data from multiple AI analysts and the bot's own trading history.

## Available Chains
${JSON.stringify(networks.results.map(n => ({ id: n.chain_id, name: n.name })))}

## Current Active Strategies
${JSON.stringify(activeStrats.results.map(s => ({ id: s.id, chain_id: s.chain_id, token: s.token_address?.slice(0, 10), stablecoin: s.stablecoin_address?.slice(0, 10), buyThreshold: s.buy_threshold_pct, sellThreshold: s.sell_threshold_pct })))}

## AI Analyst Suggestions (from Analytics worker)
${JSON.stringify(suggestions.results.slice(0, 20).map(s => s.value))}

## AI Discovery Analysis (from Discovery worker)
${JSON.stringify(discoveries.results.slice(0, 20).map(s => s.value))}

## AI Trade Risk Scores (from Execution worker)
${JSON.stringify(execScores.results.slice(0, 30).map(s => s.value))}

## Recent Trade History (last 7 days)
${JSON.stringify(trades.results.map(t => ({ strategy: t.strategy, tokenA: t.token_a?.slice(0, 10), tokenB: t.token_b?.slice(0, 10), status: t.status, profitPct: t.profit_pct })))}

## Pending Opportunities
${JSON.stringify(opportunities.results.map(o => ({ chain_id: o.chain_id, tokenA: o.token_a?.slice(0, 10), tokenB: o.token_b?.slice(0, 10), profitPct: o.profit_pct })))}

Analyze all this data and recommend NEW spot strategies. A spot strategy buys a token when its price drops X% below a reference price and sells when it rises Y%.

Rules:
- Only recommend tokens that appear in trade history or discovery data
- Use realistic buy/sell thresholds (3-15%)
- Set a reasonable trade amount (5-50 in stablecoin terms)
- Don't duplicate existing active strategies
- If data is insufficient, return an empty array

Return ONLY a JSON array (no markdown):
[{"chainId": 137, "tokenAddress": "0x...", "stablecoinAddress": "0x...", "routerAddress": "0x...", "buyThresholdPct": 5.0, "sellThresholdPct": 8.0, "tradeAmount": "10", "reason": "why this strategy makes sense"}]`;

  const text = await runAiPrompt(ai, model, prompt, 2048);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return 0;

  let recommendations: any[];
  try { recommendations = JSON.parse(match[0]); } catch { return 0; }
  if (!Array.isArray(recommendations)) return 0;

  let inserted = 0;
  for (const rec of recommendations) {
    if (!rec.chainId || !rec.tokenAddress || !rec.stablecoinAddress || !rec.routerAddress) continue;
    const exists = await db.prepare(
      'SELECT id FROM spot_strategies WHERE chain_id = ? AND LOWER(token_address) = LOWER(?) AND is_active = 1 LIMIT 1'
    ).bind(rec.chainId, rec.tokenAddress).first();
    if (exists) continue;
    try {
      await db.prepare(
        'INSERT INTO spot_strategies (chain_id, token_address, stablecoin_address, router_address, buy_threshold_pct, sell_threshold_pct, trade_amount) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(rec.chainId, rec.tokenAddress, rec.stablecoinAddress, rec.routerAddress, rec.buyThresholdPct ?? 5.0, rec.sellThresholdPct ?? 8.0, rec.tradeAmount ?? '10').run();
      await db.prepare(
        'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
      ).bind(`ai_strategy_${rec.tokenAddress.slice(0, 8)}`, JSON.stringify({ ...rec, created: new Date().toISOString() }), JSON.stringify({ ...rec, created: new Date().toISOString() })).run();
      inserted++;
    } catch {}
  }
  return inserted;
}
