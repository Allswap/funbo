import { aiModel, runAiPrompt } from '../../shared/ai-advisor';

export async function askAi(
  db: D1Database,
  ai: any,
  question: string,
  context?: Record<string, unknown>,
): Promise<string> {
  if (!ai) return 'AI not configured';

  const model = await aiModel(db);
  const ctxStr = context ? `\nContext:\n${JSON.stringify(context, null, 2)}` : '';
  const prompt = `You are the EVM bot assistant. Answer concisely.\n\nQuestion: ${question}${ctxStr}`;

  return runAiPrompt(ai, model, prompt);
}
