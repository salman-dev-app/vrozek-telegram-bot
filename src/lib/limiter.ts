/**
 * VROZEK AI — in-memory sliding-window rate limiter.
 * Best-effort per isolate (Cloudflare may run a few isolates); still blocks
 * obvious abuse on dashboards and API endpoints.
 */

const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}
