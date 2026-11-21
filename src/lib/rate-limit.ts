import type { NextRequest } from "next/server";

/**
 * Dependency-free per-key token bucket. A backstop for the endpoints that only
 * exist on the control plane (login today) so online guessing costs an attacker
 * rate, not just latency. The edge limiter is the primary control.
 *
 * shortcut: buckets live in this process, so with several replicas an attacker
 * gets one bucket per replica — move to Redis or the edge limiter when
 * replicaCount > 1.
 */
type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export type RateLimitVerdict = { limited: false } | { limited: true; retryAfterSeconds: number };

/**
 * The caller's address as the ingress proxy saw it. Rightmost, because a single
 * trusted ingress hop appends to a header the client controls — the leftmost
 * entry is whatever the attacker sent, so keying on it gives a fresh bucket per
 * guess.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const last = forwarded.split(",").pop()?.trim();
    if (last) return last;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Consume one token from `key`'s bucket: `burst` tokens capacity, refilled at
 * `burst` per `windowSeconds` (a sustained rate of burst/window).
 */
export function takeToken(
  key: string,
  burst: number,
  windowSeconds: number,
  now = Date.now()
): RateLimitVerdict {
  if (buckets.size > MAX_BUCKETS) prune(burst);

  const perMs = burst / (windowSeconds * 1000);
  const bucket = buckets.get(key) ?? { tokens: burst, updatedAt: now };
  const tokens = Math.min(burst, bucket.tokens + (now - bucket.updatedAt) * perMs);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { limited: false };
}

/** Lazy expiry: a full bucket is indistinguishable from a fresh one, so drop those. */
function prune(burst: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.tokens >= burst) buckets.delete(key);
  }
  // Still oversized (every key hit recently): start over rather than grow unbounded.
  if (buckets.size > MAX_BUCKETS) buckets.clear();
}
