import type { Stats } from './api';

/**
 * Live Mainnet counters for the landing page. Until the indexer reports real numbers this returns
 * nulls, and the UI says "Counting on Mainnet". It never returns a made-up number.
 */
export async function readStats(): Promise<Stats> {
  return { memories: null, paidRecalls: null };
}
