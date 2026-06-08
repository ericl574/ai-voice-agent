// Lightweight fixed-window rate limiter for API routes.
//
// NOTE: this is an in-memory, per-instance, best-effort limiter — it throttles a single client
// hammering one server instance and gives a logging choke-point. It is NOT a durable cross-instance
// limit; on serverless that needs a shared store (Redis/Upstash or a Supabase table) — see the
// deferred items in the plan. Good enough to stop trivial abuse / runaway loops at low cost.

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Allow up to `limit` hits per `windowMs` for `key`. Returns ok=false when exceeded.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const w = buckets.get(key);

  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  if (w.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
  }

  w.count += 1;
  return { ok: true, remaining: limit - w.count, retryAfterSec: 0 };
}

// Best-effort client key from a request (user id preferred; else forwarded IP; else 'anon').
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : 'unknown';
  return `ip:${ip}`;
}
