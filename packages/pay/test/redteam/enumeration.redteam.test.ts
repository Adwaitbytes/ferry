import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { GateGuard } from '../../src/guard.js';
import { CARD_ID, NOW_MS, RECIPIENT, setup } from '../fixtures.js';

let db: PGlite | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe('Gate card enumeration (REDTEAM 10)', () => {
  it('RT-53 malformed and injected card ids are rejected with no database query', async () => {
    const env = await setup();
    db = env.db;
    const guard = new GateGuard(env.store);
    env.sql.statements.length = 0;
    for (const id of ['1', "' OR 1=1--", 'q3V7mT0xR9bK2wY5pL8nA', 'q3V7mT0xR9bK2wY5pL8nAg%00', '../admin']) {
      expect(await guard.resolveCard(id, '203.0.113.7', NOW_MS)).toEqual({ kind: 'invalid' });
    }
    expect(env.sql.statements).toEqual([]);
  });

  it('RT-54 unknown, killed and disabled cards are indistinguishable', async () => {
    const env = await setup();
    db = env.db;
    const guard = new GateGuard(env.store);
    const disabled = await env.store.createCard({ ...env.card, id: 'Zr8kP1vN4cT7wQ2mX5yB0a', allowedAgents: [] });
    await env.store.updateCard(disabled.id, RECIPIENT, { enabled: false });
    await env.store.killCard(CARD_ID, RECIPIENT);
    for (const id of ['AAAAAAAAAAAAAAAAAAAAAA', CARD_ID, disabled.id]) {
      expect(await guard.resolveCard(id, '203.0.113.8', NOW_MS)).toEqual({ kind: 'not_found' });
    }
  });

  it('RT-55 404 flood from one IP is rate limited, other IPs are not', async () => {
    const env = await setup();
    db = env.db;
    const guard = new GateGuard(env.store);
    const ids = Array.from({ length: 25 }, (_, i) => 'A'.repeat(20) + String(i).padStart(2, '0').replace(/\d/g, (d) => 'abcdefghij'[Number(d)] ?? 'a'));
    const results = [];
    for (const id of ids) results.push(await guard.resolveCard(id, '203.0.113.7', NOW_MS));
    expect(results.slice(0, 20).every((r) => r.kind === 'not_found')).toBe(true);
    for (const r of results.slice(20)) {
      expect(r.kind).toBe('limited');
      expect(r.kind === 'limited' && r.retryAfterS > 0).toBe(true);
    }
    expect(await guard.resolveCard(ids[0] ?? '', '198.51.100.9', NOW_MS)).toEqual({ kind: 'not_found' });
  });
});
