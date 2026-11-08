import { neonSqlClient } from '@ferry/pay/neon';
import type { SqlClient } from '@ferry/pay';
import type { Stats } from './api';

/**
 * Live Mainnet counters for the landing page and Proofs. Each number is either read from Neon or
 * null, and the UI says "Counting on Mainnet" for null. It never returns a made-up number.
 *
 * - paidRecalls: rows in the Gate's `payments` table, each one a Tatum-verified USDC payment.
 * - memories: the last count `scripts/count-memories.ts` wrote to `public_stats` from listMemories.
 */

export const MEMORIES_STAT_KEY = 'memories';
const CACHE_MS = 60_000;

interface CountRow extends Record<string, unknown> {
  n: string | number;
}

interface StatRow extends Record<string, unknown> {
  stat_value: string | number;
  counted_at: string | Date;
}

function toCount(value: string | number | undefined): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function toIso(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** One failing counter must not hide the other, and a failure is reported, never invented over. */
async function attempt<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`stats: ${label} unavailable (${error instanceof Error ? error.name : 'unknown'})`);
    return null;
  }
}

export async function readStatsFrom(sql: SqlClient): Promise<Stats> {
  const [paid, memories] = await Promise.all([
    attempt('paidRecalls', async () => toCount((await sql.query<CountRow>('SELECT count(*) AS n FROM payments'))[0]?.n)),
    attempt('memories', async () => {
      const row = (await sql.query<StatRow>('SELECT stat_value, counted_at FROM public_stats WHERE stat_key = $1', [MEMORIES_STAT_KEY]))[0];
      return row ? { count: toCount(row.stat_value), asOf: toIso(row.counted_at) } : null;
    }),
  ]);
  const asOf = memories?.asOf;
  return { memories: memories?.count ?? null, paidRecalls: paid, ...(asOf ? { asOf } : {}) };
}

let cached: { at: number; stats: Promise<Stats> } | null = null;

export function readStats(): Promise<Stats> {
  const url = process.env['DATABASE_URL'];
  if (!url) return Promise.resolve({ memories: null, paidRecalls: null });
  const now = Date.now();
  // Landing renders per request; one Neon round trip a minute per instance is plenty for counters.
  if (cached === null || now - cached.at > CACHE_MS) cached = { at: now, stats: readStatsFrom(neonSqlClient(url)) };
  return cached.stats;
}
