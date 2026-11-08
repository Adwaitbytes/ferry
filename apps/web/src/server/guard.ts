import { createSafeLogger, type SafeLog } from '@ferry/distill';

/**
 * Per-instance token bucket keyed by client IP. Fluid Compute reuses instances, so this bounds
 * bursts per instance; it is a cost guard for team LLM keys, not an auth boundary.
 */
const buckets = new Map<string, { tokens: number; updated: number }>();
const MAX_KEYS = 10_000;

export function takeToken(key: string, perMinute: number, now = Date.now()): boolean {
  const bucket = buckets.get(key) ?? { tokens: perMinute, updated: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.updated) / 60_000) * perMinute);
  bucket.updated = now;
  if (buckets.size >= MAX_KEYS && !buckets.has(key)) buckets.clear();
  buckets.set(key, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export const log: SafeLog = createSafeLogger((line) => console.warn(line));

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export const MAX_JSON_BYTES = 256 * 1024;

/** Reads a body as text with a hard byte cap, so oversized payloads never reach JSON.parse. */
export async function readCapped(req: Request, maxBytes = MAX_JSON_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return null;
  const text = await req.text();
  return new TextEncoder().encode(text).byteLength > maxBytes ? null : text;
}
