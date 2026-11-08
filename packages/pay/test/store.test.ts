import type { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { GateGuard } from '../src/guard.js';
import { applyMigrations, splitStatements } from '../src/migrate.js';
import { findMemoryTextColumns } from '../src/schema-check.js';
import { BASE_CHALLENGE, CARD_ID, DIGEST, PAYER, Q_SHA, RECIPIENT, setup } from './fixtures.js';

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe('PayStore', () => {
  it('scopes updates and kills to the owner and lists earnings with totals', async () => {
    const env = await setup();
    db = env.db;
    expect(await env.store.updateCard(CARD_ID, PAYER, { name: 'Stolen' })).toBeNull();
    expect(await env.store.killCard(CARD_ID, PAYER)).toBe(false);
    expect(await env.store.updateCard(CARD_ID, RECIPIENT, { name: 'Food 2', priceMicros: 10_000n, dailyCap: 5, scopeLabel: 'Food' })).toMatchObject({
      name: 'Food 2',
      dailyCap: 5,
    });
    expect(await env.store.listCardsByOwner(RECIPIENT)).toHaveLength(1);

    const now = Date.now();
    expect(
      await env.store.commitPayment({
        receiptId: 'rcpt_AAAAAAAAAAAAAAAAAAAAAA',
        digest: DIGEST,
        challengeId: BASE_CHALLENGE.id,
        cardId: CARD_ID,
        payer: PAYER,
        amountMicros: 10_000n,
        querySha256: Q_SHA,
        dialect: 'mpp',
      }),
    ).toBe(true);
    expect(await env.store.incrementDaily(CARD_ID, now)).toBe(1);
    expect(await env.store.getDailyCount(CARD_ID, now)).toBe(1);
    const earnings = await env.store.earnings(RECIPIENT, now, 50);
    expect(earnings).toMatchObject({ count: 1, totalMicros: 10_000n, todayMicros: 10_000n });
    expect(earnings.payments[0]).toMatchObject({ digest: DIGEST, payer: PAYER, querySha256: Q_SHA, cardName: 'Food 2' });
    expect(await env.store.earnings(PAYER, now, 50)).toMatchObject({ count: 0, totalMicros: 0n });

    expect(await env.store.killCard(CARD_ID, RECIPIENT)).toBe(true);
    expect(await env.store.updateCard(CARD_ID, RECIPIENT, { enabled: true })).toBeNull();
    await env.store.prune(now + 3 * 24 * 3_600_000);
    expect(await env.store.getChallenge(BASE_CHALLENGE.id)).not.toBeNull();
  });

  it('enforces the daily cap and per-IP and global limits', async () => {
    const env = await setup();
    db = env.db;
    const card = await env.store.updateCard(CARD_ID, RECIPIENT, { dailyCap: 1 });
    if (!card) throw new Error('card missing');
    const guard = new GateGuard(env.store, {
      notFoundPerIp: 1,
      notFoundWindowMs: 60_000,
      requestsPerIp: 2,
      requestsPerIpWindowMs: 60_000,
      requestsGlobal: 2,
      requestsGlobalWindowMs: 60_000,
    });
    const now = Date.now();
    expect(await guard.underDailyCap(card, now)).toBe(true);
    await env.store.incrementDaily(CARD_ID, now);
    expect(await guard.underDailyCap(card, now)).toBe(false);
    expect(await guard.limitRequest('1.1.1.1', now)).toBeNull();
    expect(await guard.limitRequest('1.1.1.1', now)).toBeNull();
    expect(await guard.limitRequest('1.1.1.1', now)).toBeGreaterThan(0);
    expect(await guard.limitRequest('2.2.2.2', now)).toBeGreaterThan(0);
    expect(await guard.resolveCard(CARD_ID, '3.3.3.3', now)).toMatchObject({ kind: 'card' });
  });
});

describe('migrations and schema', () => {
  it('is idempotent and refuses odd migration names', async () => {
    const env = await setup();
    db = env.db;
    expect(await applyMigrations(env.sql, [])).toEqual([]);
    await expect(applyMigrations(env.sql, [{ name: 'evil.sql', sql: 'SELECT 1' }])).rejects.toThrow(/not allowed/);
    expect(splitStatements('-- c\nSELECT 1;\n\nSELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('X-DB-1 the shipped schema has no column that can hold memory text', async () => {
    const env = await setup();
    db = env.db;
    expect(await findMemoryTextColumns(env.sql)).toEqual([]);
  });

  it('X-DB-1 the check catches banned names, unbounded text and long labels', async () => {
    const env = await setup();
    db = env.db;
    await env.sql.query('CREATE TABLE leak (fact_text text, note text, label varchar(500))');
    expect(await findMemoryTextColumns(env.sql)).toEqual([
      { column: 'leak.fact_text', problem: 'banned_name' },
      { column: 'leak.fact_text', problem: 'unbounded_text' },
      { column: 'leak.label', problem: 'label_too_long' },
      { column: 'leak.note', problem: 'unbounded_text' },
    ]);
  });
});
