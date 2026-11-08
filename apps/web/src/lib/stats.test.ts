import type { SqlClient } from '@ferry/pay';
import { describe, expect, it, vi } from 'vitest';
import { readStats, readStatsFrom } from './stats';

function fakeSql(handlers: { payments?: () => unknown[]; stats?: () => unknown[] }): SqlClient {
  return {
    query: async <Row extends Record<string, unknown>>(text: string) => {
      const handler = text.includes('FROM payments') ? handlers.payments : handlers.stats;
      if (!handler) throw new Error('relation does not exist');
      return handler() as Row[];
    },
  };
}

describe('readStatsFrom', () => {
  it('returns the payments count and the cached memory count with its timestamp', async () => {
    const stats = await readStatsFrom(
      fakeSql({ payments: () => [{ n: '3' }], stats: () => [{ stat_value: '1204', counted_at: '2026-11-09T01:00:00Z' }] }),
    );
    expect(stats).toEqual({ paidRecalls: 3, memories: 1204, asOf: '2026-11-09T01:00:00.000Z' });
  });

  it('returns null, never a guess, when a counter is missing or unreadable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await readStatsFrom(fakeSql({ payments: () => [{ n: '2' }] }))).toEqual({ paidRecalls: 2, memories: null });
    expect(await readStatsFrom(fakeSql({ payments: () => [{ n: '-1' }], stats: () => [] }))).toEqual({ paidRecalls: null, memories: null });
    expect(await readStatsFrom(fakeSql({}))).toEqual({ paidRecalls: null, memories: null });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('readStats', () => {
  it('is all null without a database', async () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(await readStats()).toEqual({ memories: null, paidRecalls: null });
    vi.unstubAllEnvs();
  });
});
