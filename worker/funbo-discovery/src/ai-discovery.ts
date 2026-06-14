import { aiModel, runAiPrompt } from '../../shared/ai-advisor';

export interface AiDiscoveryResult {
  pairKey: string;
  score: number;
  reason: string;
}

export async function analyzeDiscoveredPairs(
  db: D1Database,
  ai: any,
  chainId: number,
  pairs: { tokenA: string; tokenB: string; label?: string; dexLabel?: string }[],
): Promise<AiDiscoveryResult[]> {
  if (pairs.length === 0 || !ai) return [];

  const model = await aiModel(db);
  const prompt = `You are a crypto discovery analyst. Analyze these newly discovered token pairs on chain ${chainId} and score each from 0-10 (10 = best) for trading potential.

Rules:
- Prefer pairs with recognizable symbols
- Deduct points for obviously scammy names (meme overload, misspellings of known tokens)
- Favor pairs on well-known DEXs
- Be concise

Pairs:
${JSON.stringify(pairs.map((p, i) => ({ idx: i, tokenA: p.tokenA?.slice(0, 10) + '...', tokenB: p.tokenB?.slice(0, 10) + '...', label: p.label, dex: p.dexLabel })), null, 2)}

Return a JSON array:
[{"idx": 0, "score": 7, "reason": "short reason"}]`;

  const text = await runAiPrompt(ai, model, prompt);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]) as { idx: number; score: number; reason: string }[];
    return parsed.map((r) => ({
      pairKey: `${pairs[r.idx]?.tokenA || ''}_${pairs[r.idx]?.tokenB || ''}`,
      score: r.score,
      reason: r.reason,
    }));
  } catch {
    return [];
  }
}

export async function generateDiscoverySummary(
  db: D1Database,
  ai: any,
  chainId: number,
  newPairsCount: number,
  totalPoolsChecked: number,
): Promise<string> {
  if (!ai) return '';

  const model = await aiModel(db);
  const prompt = `Discovery run complete on chain ${chainId}. Found ${newPairsCount} new pairs across ${totalPoolsChecked} pools. Write a one-sentence summary.`;

  return runAiPrompt(ai, model, prompt);
}
