import { AccountView, BlobView } from '@ferry/core';
import { z } from 'zod';

/**
 * Typed fetchers for Ferry's own HTTP APIs. Chain reads go through the Tatum proxy under
 * /api/chain (owned by the chain engineer); the web page never holds the Tatum key.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function describeStatus(source: string, status: number, retryAfterMs: number | undefined): string {
  if (status === 429) return `${source} returned 429, retrying in ${Math.ceil((retryAfterMs ?? 10_000) / 1000)}s.`;
  if (status === 0) return `Could not reach ${source}. Check your connection and try again.`;
  return `${source} returned ${status}. Try again.`;
}

async function getJson<T>(url: string, schema: z.ZodType<T>, source: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { accept: 'application/json', ...init.headers } });
  } catch {
    throw new ApiError(0, describeStatus(source, 0, undefined));
  }
  if (!response.ok) {
    const seconds = Number(response.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
    throw new ApiError(response.status, describeStatus(source, response.status, retryAfterMs), retryAfterMs);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(502, `${source} sent a response this page cannot read.`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(502, `${source} sent a response this page cannot read.`);
  return parsed.data;
}

const TATUM = 'Tatum';

/** Detects the owner's MemWalAccount through the Tatum proxy. `null` means none exists yet. */
export async function getAccountByOwner(owner: string): Promise<AccountView | null> {
  try {
    return await getJson(`/api/chain/account/by-owner/${encodeURIComponent(owner)}`, AccountView, TATUM, { cache: 'no-store' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function getAccount(accountId: string): Promise<AccountView> {
  return getJson(`/api/chain/account/${encodeURIComponent(accountId)}`, AccountView, TATUM, { cache: 'no-store' });
}

export async function getBlob(blobId: string): Promise<{ blob: BlobView; latencyMs: number }> {
  const started = performance.now();
  const blob = await getJson(`/api/chain/blob/${encodeURIComponent(blobId)}`, BlobView, TATUM);
  return { blob, latencyMs: Math.round(performance.now() - started) };
}

const MethodMeter = z.looseObject({
  calls: z.number().nonnegative(),
  credits: z.number().nonnegative(),
  errors: z.number().nonnegative().optional(),
  cacheHits: z.number().nonnegative().optional(),
});

export const MeterSnapshot = z.looseObject({
  since: z.string(),
  totalCalls: z.number().nonnegative(),
  totalCredits: z.number().nonnegative(),
  totalErrors: z.number().nonnegative().optional(),
  methods: z.record(z.string(), MethodMeter),
  /** Monthly plan allowance, when the proxy knows it. */
  monthlyLimit: z.number().positive().optional(),
});
export type MeterSnapshot = z.infer<typeof MeterSnapshot>;

export function getMeter(): Promise<MeterSnapshot> {
  return getJson('/api/chain/meter', MeterSnapshot, TATUM, { cache: 'no-store' });
}

export const Stats = z.object({
  memories: z.number().int().nonnegative().nullable(),
  paidRecalls: z.number().int().nonnegative().nullable(),
  asOf: z.iso.datetime().optional(),
});
export type Stats = z.infer<typeof Stats>;

export function getStats(): Promise<Stats> {
  return getJson('/api/stats', Stats, 'Ferry', { cache: 'no-store' });
}
