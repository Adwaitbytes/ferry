/**
 * Copies facts the user approved into the Public profile account, namespace `ferry-public`, so a
 * Share Card can sell them. Usage: `pnpm publish-public <approved-facts.json>`, where the file is
 * the "Download approved facts" export from the Share page.
 *
 * Reads GATE_PUBLIC_ACCOUNT_ID and GATE_DELEGATE_PRIVATE_KEY from .env.local: the Gate's own
 * delegate, which can only ever reach the Public profile account (THREAT_MODEL X-GATE-1). The
 * private account and its key are never involved. Each fact is screened again here and anything
 * sensitive, instruction-like or oversized is refused rather than published.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PublishableFacts, publishableToCandidate, type CandidateFact } from '@ferry/core';
import { screenCandidate } from '@ferry/distill';
import { FerryMemory } from '@ferry/memwal';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { relayerUrl, requireAccountId, requireDelegateSeed } from './lib/env.ts';

async function main(): Promise<number> {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: pnpm publish-public <approved-facts.json>');
    return 2;
  }
  const accountId = requireAccountId('GATE_PUBLIC_ACCOUNT_ID');
  const seed = requireDelegateSeed('GATE_DELEGATE_PRIVATE_KEY');
  const privateIds = (process.env['GATE_PRIVATE_ACCOUNT_IDS'] ?? '').split(',').map((id) => id.trim().toLowerCase());
  if (privateIds.includes(accountId)) {
    console.error('GATE_PUBLIC_ACCOUNT_ID is listed as a private account. Nothing was published.');
    return 1;
  }

  const parsed = PublishableFacts.safeParse(JSON.parse(await readFile(path, 'utf8')));
  if (!parsed.success) {
    console.error(`${path} is not a list of approved facts: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    return 1;
  }

  const today = new Date().toISOString().slice(0, 10);
  const facts: CandidateFact[] = [];
  parsed.data.forEach((input, index) => {
    const screen = screenCandidate(input.text);
    if (screen.verdict !== 'accept') {
      console.error(`#${index + 1} refused (${screen.reasons.join(', ')}). Public facts must carry nothing sensitive.`);
      return;
    }
    facts.push(publishableToCandidate({ ...input, text: screen.text }, randomUUID(), today));
  });
  if (facts.length === 0) {
    console.error('No fact passed screening. Nothing was published.');
    return 1;
  }

  // The local index is throwaway here: this run writes and exits, so an in-memory IndexedDB is enough.
  const memory = new FerryMemory({ seed, accountId, serverUrl: relayerUrl(), dbOptions: { indexedDB, IDBKeyRange } });
  try {
    const results = await memory.writeFacts(facts, { namespace: 'ferry-public' });
    let written = 0;
    for (const [index, result] of results.entries()) {
      if (result.status === 'written') written += 1;
      console.log(`#${index + 1} ${result.status}${result.status === 'written' ? ` ${result.ref}` : ''}`);
    }
    console.log(`Published ${written} of ${parsed.data.length} facts to ferry-public on ${accountId}.`);
    return written === facts.length ? 0 : 1;
  } finally {
    memory.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : 'publish-public failed');
    process.exit(1);
  },
);
