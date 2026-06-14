import { aiModel, runAiPrompt } from '../../shared/ai-advisor';

export interface AiTradeScore {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reasons: string[];
}

export async function scoreTrade(
  db: D1Database,
  ai: any,
  trade: {
    type: string;
    tokenA: string;
    tokenB: string;
    router: string;
    amountIn: string;
    profitPct: number;
    chainId?: number;
  },
): Promise<AiTradeScore | null> {
  if (!ai) return null;

  const model = await aiModel(db);
  const prompt = `You are a trade risk assessor for an EVM arbitrage bot. Score this trade 0-100 where 0 = safe, 100 = extremely risky.

Trade:
- Type: ${trade.type}
- Chain: ${trade.chainId || 'unknown'}
- Token A: ${trade.tokenA?.slice(0, 10)}...
- Token B: ${trade.tokenB?.slice(0, 10)}...
- Router: ${trade.router?.slice(0, 10)}...
- Amount: ${trade.amountIn}
- Expected profit: ${trade.profitPct}%

Consider: sandwich risk, token legitimacy, router reputation, profit size relative to risk.

Return JSON:
{"riskScore": 25, "riskLevel": "low", "reasons": ["reason 1", "reason 2"]}`;

  const text = await runAiPrompt(ai, model, prompt);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const score = JSON.parse(match[0]) as AiTradeScore;
    const key = `ai_execution_${trade.type}_${trade.tokenA.slice(0, 8)}_${Date.now()}`;
    await db.prepare(
      'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
    ).bind(key, JSON.stringify({ ...trade, score }), JSON.stringify({ ...trade, score })).run();
    return score;
  } catch {
    return null;
  }
}
