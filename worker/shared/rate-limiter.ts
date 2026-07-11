export interface RateLimitConfig {
  limitPerWindow: number;
  windowMs: number;
  backoffMs: number;
  maxBackoffMs: number;
  recoveryFactor: number;
}

type RateLimitService = 'goplus' | 'blockscout' | 'rpc' | 'worker_cpu';

const SERVICE_CONFIGS: Record<RateLimitService, RateLimitConfig> = {
  goplus:       { limitPerWindow: 20, windowMs: 60_000, backoffMs: 2_000, maxBackoffMs: 30_000, recoveryFactor: 0.9 },
  blockscout:   { limitPerWindow: 120, windowMs: 60_000, backoffMs: 500,   maxBackoffMs: 15_000, recoveryFactor: 0.95 },
  rpc:          { limitPerWindow: 100, windowMs: 60_000, backoffMs: 500,   maxBackoffMs: 15_000, recoveryFactor: 0.95 },
  worker_cpu:   { limitPerWindow: 1,  windowMs: 10_000, backoffMs: 100,   maxBackoffMs: 5_000,  recoveryFactor: 0.8 },
};

const RPC_PROVIDER_LIMITS: Record<string, { rpm: number; rpd: number }> = {
  drpc:       { rpm: 50,  rpd: 50000 },
  publicnode: { rpm: 50,  rpd: 50000 },
  blockscout: { rpm: 120, rpd: 100000 },
  chainstack: { rpm: 120, rpd: 100000 },
  ankr:       { rpm: 70,  rpd: 100000 },
  getblock:   { rpm: 30,  rpd: 40000 },
  nownodes:   { rpm: 10,  rpd: 10000 },
  '1rpc':     { rpm: 50,  rpd: 50000 },
};

interface ServiceState {
  usage: number;
  windowStart: number;
  backoffMs: number;
  lastRateLimitAt: number;
  consecutiveRateLimits: number;
  totalCalls: number;
  totalRateLimited: number;
}

const state = new Map<string, ServiceState>();

function getState(service: string): ServiceState {
  let s = state.get(service);
  if (!s) {
    const cfg = SERVICE_CONFIGS[service as RateLimitService] || SERVICE_CONFIGS.rpc;
    state.set(service, s = {
      usage: 0,
      windowStart: Date.now(),
      backoffMs: cfg.backoffMs,
      lastRateLimitAt: 0,
      consecutiveRateLimits: 0,
      totalCalls: 0,
      totalRateLimited: 0,
    });
  }
  const cfg = SERVICE_CONFIGS[service as RateLimitService] || SERVICE_CONFIGS.rpc;
  if (Date.now() - s.windowStart > cfg.windowMs) {
    s.usage = 0;
    s.windowStart = Date.now();
    s.consecutiveRateLimits = 0;
  }
  return s;
}

export function isRateLimitError(err: any): boolean {
  if (!err) return false;
  const msg = (typeof err.message === 'string' ? err.message : String(err)).toLowerCase();
  const status = err.status || err.statusCode || 0;
  return (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('rate_limit') ||
    msg.includes('429') ||
    msg.includes('max rate')
  );
}

export interface RateLimitStatus {
  allowed: boolean;
  retryAfterMs: number;
  usage: number;
  limitPerWindow: number;
  backoffMs: number;
}

export function getRateLimitStatus(service: string): RateLimitStatus {
  const s = getState(service);
  const cfg = SERVICE_CONFIGS[service as RateLimitService] || SERVICE_CONFIGS.rpc;

  const sinceRateLimit = Date.now() - s.lastRateLimitAt;
  if (sinceRateLimit < s.backoffMs) {
    return { allowed: false, retryAfterMs: s.backoffMs - sinceRateLimit, usage: s.usage, limitPerWindow: cfg.limitPerWindow, backoffMs: s.backoffMs };
  }

  if (s.usage >= cfg.limitPerWindow) {
    const elapsed = Date.now() - s.windowStart;
    return { allowed: false, retryAfterMs: Math.max(100, cfg.windowMs - elapsed), usage: s.usage, limitPerWindow: cfg.limitPerWindow, backoffMs: s.backoffMs };
  }

  return { allowed: true, retryAfterMs: 0, usage: s.usage, limitPerWindow: cfg.limitPerWindow, backoffMs: s.backoffMs };
}

export function incrementUsage(service: string): void {
  const s = getState(service);
  s.usage++;
  s.totalCalls++;
}

export function recordRateLimit(service: string): void {
  const s = getState(service);
  const cfg = SERVICE_CONFIGS[service as RateLimitService] || SERVICE_CONFIGS.rpc;
  s.lastRateLimitAt = Date.now();
  s.consecutiveRateLimits++;
  s.totalRateLimited++;
  s.backoffMs = Math.min(s.backoffMs * 2, cfg.maxBackoffMs);
  console.log(`[rate-limit] ${service} throttled (${s.consecutiveRateLimits}x), backoff ${s.backoffMs}ms`);
}

export function recordSuccess(service: string): void {
  const s = getState(service);
  const cfg = SERVICE_CONFIGS[service as RateLimitService] || SERVICE_CONFIGS.rpc;
  if (s.consecutiveRateLimits > 0) s.consecutiveRateLimits--;
  s.backoffMs = Math.max(cfg.backoffMs, Math.floor(s.backoffMs * cfg.recoveryFactor));
}

export async function callWithRateLimit<T>(
  service: string,
  fn: () => Promise<T>,
): Promise<T> {
  const status = getRateLimitStatus(service);
  if (!status.allowed) {
    const err = new Error(`Rate limited: ${service} (usage ${status.usage}/${status.limitPerWindow}, backoff ${status.backoffMs}ms, retry in ${status.retryAfterMs}ms)`);
    (err as any).rateLimited = true;
    (err as any).retryAfterMs = status.retryAfterMs;
    (err as any).service = service;
    throw err;
  }

  incrementUsage(service);

  try {
    const result = await fn();
    recordSuccess(service);
    return result;
  } catch (err: any) {
    if (isRateLimitError(err)) {
      recordRateLimit(service);
    }
    throw err;
  }
}

export function getServiceStats(service: string): { totalCalls: number; totalRateLimited: number; backoffMs: number; usage: number } | null {
  const s = state.get(service);
  if (!s) return null;
  return { totalCalls: s.totalCalls, totalRateLimited: s.totalRateLimited, backoffMs: s.backoffMs, usage: s.usage };
}

export function getAllStats(): Record<string, { totalCalls: number; totalRateLimited: number; backoffMs: number; usage: number }> {
  const result: any = {};
  for (const [key, s] of state.entries()) {
    result[key] = { totalCalls: s.totalCalls, totalRateLimited: s.totalRateLimited, backoffMs: s.backoffMs, usage: s.usage };
  }
  return result;
}


