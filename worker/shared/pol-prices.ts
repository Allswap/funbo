/**
 * Live POL (Polygon native) prices — for live USD tx-cost / minimum-received / min-recohit estimates.
 * Cached in Workers KV (2 min) with in-memory + constant fallback so a gecko outage never blocks trades.
 */
const POL_PX_KEY = 'pol_price_usd';
const POL_PX_TTL_MS = 120_000;
const DEFAULT_POL_USD = 0.35; // conservative floor; refresh from CoinGecko when reachable

let memFallback: { px: number; at: number } | null = null;

const POL_ID = 'polygon-ecosystem-token';
const POL_PX_URL = `https://api.coingecko.com/api/v3/simple/price?ids=${POL_ID}&vs_currencies=usd`;

export async function getPolPriceUsd(env?: any): Promise<number> {
  try {
    const now = Date.now();
    if (memFallback && now - memFallback.at < POL_PX_TTL_MS) return memFallback.px;

    const kv = env?.FUNBO_KV;
    if (kv) {
      const cached = await kv.get(POL_PX_KEY).catch(() => null);
      if (cached) {
        const p = Number(cached);
        if (isFinite(p) && p > 0) {
          memFallback = { px: p, at: now };
          return p;
        }
      }
    }

    const res = await fetch(POL_PX_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const json: any = await res.json();
      const px = Number(json?.[POL_ID]?.usd);
      if (isFinite(px) && px > 0) {
        memFallback = { px, at: now };
        if (kv) await kv.put(POL_PX_KEY, String(px), { expirationTtl: Math.ceil(POL_PX_TTL_MS / 1000) }).catch(() => {});
        return px;
      }
    }
    return memFallback?.px ?? DEFAULT_POL_USD;
  } catch {
    return memFallback?.px ?? DEFAULT_POL_USD;
  }
}

export function weiToUsd(wei: bigint | string | number, polPriceUsd: number): number {
  const w = typeof wei === 'bigint' ? wei : BigInt(String(wei || 0));
  return (Number(w) / 1e18) * polPriceUsd;
}