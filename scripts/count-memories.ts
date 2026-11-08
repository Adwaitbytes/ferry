/**
 * Writes the landing page "memories on Walrus" counter. Counts the main account's `ferry-core`
 * records from listMemories metadata (no text is read) and stores only the number and a timestamp
 * in Neon `public_stats` (migration 0002). Run on a schedule: `pnpm count-memories`.
 *
 * Env (.env.local): FERRY_COUNT_ACCOUNT_ID, FERRY_COUNT_DELEGATE_KEY (a delegate of that account),
 * DATABASE_URL.
 */
import { FerryMemory } from '@ferry/memwal';
import { neon } from '@neondatabase/serverless';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { relayerUrl, requireAccountId, requireDelegateSeed, requireEnv } from './lib/env.ts';

async function main(): Promise<void> {
  const accountId = requireAccountId('FERRY_COUNT_ACCOUNT_ID');
  const seed = requireDelegateSeed('FERRY_COUNT_DELEGATE_KEY');
  const sql = neon(requireEnv('DATABASE_URL'));

  const memory = new FerryMemory({ seed, accountId, serverUrl: relayerUrl(), dbOptions: { indexedDB, IDBKeyRange } });
  let count: number;
  try {
    count = await memory.countListed('ferry-core');
  } finally {
    memory.destroy();
  }

  await sql.query(
    `INSERT INTO public_stats (stat_key, stat_value, counted_at) VALUES ('memories', $1, now())
     ON CONFLICT (stat_key) DO UPDATE SET stat_value = EXCLUDED.stat_value, counted_at = EXCLUDED.counted_at`,
    [count],
  );
  console.log(`memories = ${count} (written to public_stats)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'count-memories failed');
  process.exit(1);
});
