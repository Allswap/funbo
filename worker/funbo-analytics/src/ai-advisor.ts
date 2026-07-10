import { runAiAdvisorBase } from '../../shared/ai-advisor';

interface AiSuggestion {
  type: 'report' | 'alert' | 'config';
  target: string;
  label: string;
  currentValue: string;
  suggestedValue: string;
  priority: 'low' | 'medium' | 'high';
  reason: string;
}

export async function runAiAdvisor(env: Env): Promise<AiSuggestion[]> {
  const DB = env['funbo-db'];

  const tradeOverview = await DB.prepare(
    `SELECT strategy, COUNT(*) as count, SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as wins,
            AVG(profit_pct) as avg_profit, SUM(profit_pct) as total_profit
     FROM trades
     WHERE created_at > datetime('now', '-7 days')
     GROUP BY strategy`
  ).all();

  const recentFails = await DB.prepare(
    `SELECT strategy, token_a, token_b, error_msg, created_at
     FROM trades
     WHERE status = 'failed' AND created_at > datetime('now', '-7 days')
     ORDER BY created_at DESC LIMIT 20`
  ).all();

  const pnl = await DB.prepare(
    'SELECT date, total_profit_pct, trade_count, total_loss_pct FROM daily_pnl ORDER BY date DESC LIMIT 14'
  ).all();

  const notifSettings = await DB.prepare(
    "SELECT key, value FROM config WHERE key NOT LIKE 'ai_suggest_%' AND key NOT IN ('system_api_key', 'default_password', 'blockscout_api_key', 'signer_private_key', 'bot_secret')"
  ).all();
  const notifMap: Record<string, string> = {};
  for (const row of notifSettings.results as Record<string, unknown>[]) { notifMap[row.key as string] = row.value as string; }

  const prompt = `You are a reporting and notification AI for an EVM arbitrage bot. Analyze the 7-day performance data and suggest improvements to notification settings and reporting behavior.

Trade overview (last 7 days):
${JSON.stringify(tradeOverview.results, null, 2)}

Recent failures:
${JSON.stringify(recentFails.results, null, 2)}

Daily PnL (last 14 days):
${JSON.stringify(pnl.results, null, 2)}

Notification and config settings:
${JSON.stringify(notifMap, null, 2)}

Focus areas:
1. Alert frequency tuning — if failures are frequent, suggest lowering throttle or adding critical channels
2. Urgency classifications — move recurring failures to 'urgent' or 'warning'
3. Reporting schedule — if profit trend is flat for 3+ days, suggest summary reports
4. Wallet tagging — suggest grouping wallets by chain for clearer reports
5. Ignore noise — if a config key already exists don't duplicate it

Return a JSON array:
[{
  "type": "report" | "alert" | "config",
  "target": "configKey or channel",
  "label": "human-friendly description",
  "currentValue": "e.g. '3600000'",
  "suggestedValue": "e.g. '1800000'",
  "priority": "high" | "medium" | "low",
  "reason": "1-2 sentences"
}]`;

  const ai: any = env.AI;
  if (!ai) return [];

  const suggestions = await runAiAdvisorBase(DB, ai, prompt);
  return suggestions as AiSuggestion[];
}
