import { describe, expect, it } from 'vitest';
import { SESSION_KEY, VAULT_KEY } from '../src/worker/vault';
import { PASSPHRASE, contentSender, harness, openPaired, panelSender } from './helpers';

describe('lock state machine', () => {
  it('goes uninitialized, open on first passphrase, locked on lock', async () => {
    const h = harness();
    expect(await h.worker.vault.state()).toBe('uninitialized');
    await h.worker.vault.open(PASSPHRASE);
    expect(await h.worker.vault.state()).toBe('open');
    expect(h.local.data.get(VAULT_KEY)).toMatchObject({ v: 1, publicKeyHex: 'ab'.repeat(32) });
    expect(h.session.data.get(SESSION_KEY)).toBeDefined();
    await h.worker.vault.lock();
    expect(await h.worker.vault.state()).toBe('locked');
    expect(h.session.data.has(SESSION_KEY)).toBe(false);
    expect(h.worker.vault.keyInMemory()).toBe(false);
  });

  it('rejects a wrong passphrase without opening and slows repeated guesses', async () => {
    const h = harness();
    await h.worker.vault.open(PASSPHRASE);
    await h.worker.vault.lock();
    for (let i = 0; i < 5; i++) {
      expect(
        await h.worker.route(
          { type: 'unlock', passphrase: 'wrong passphrase' },
          panelSender,
          'internal',
        ),
      ).toMatchObject({ ok: false, code: 'locked' });
    }
    const blocked = await h.worker.route(
      { type: 'unlock', passphrase: PASSPHRASE },
      panelSender,
      'internal',
    );
    expect(blocked).toMatchObject({ ok: false, code: 'locked', retryAfterMs: 30_000 });
    h.clock.t += 30_001;
    expect(
      (await h.worker.route({ type: 'unlock', passphrase: PASSPHRASE }, panelSender, 'internal'))
        .ok,
    ).toBe(true);
  });

  it('auto-locks after the configured idle time on the next privileged call', async () => {
    const h = await openPaired();
    h.clock.t += 29 * 60_000;
    expect(
      (
        await h.worker.route(
          { type: 'recall.suggest', site: 'claude', draft: 'plan dinner for friday' },
          contentSender(),
          'internal',
        )
      ).ok,
    ).toBe(true);
    h.clock.t += 30 * 60_000 + 1;
    expect(
      await h.worker.route(
        { type: 'recall.suggest', site: 'claude', draft: 'plan dinner for sunday' },
        contentSender(),
        'internal',
      ),
    ).toMatchObject({ ok: false, code: 'locked' });
    expect(h.engine.destroyed).toBe(true);
    expect(h.session.data.has(SESSION_KEY)).toBe(false);
  });

  it('honors a shorter auto-lock setting', async () => {
    const h = await openPaired();
    await h.worker.route(
      { type: 'settings.set', patch: { autoLockMinutes: 5 } },
      panelSender,
      'internal',
    );
    h.clock.t += 5 * 60_000 + 1;
    expect(await h.worker.vault.state()).toBe('locked');
  });

  it('restores an open session after a worker restart, but not an expired one', async () => {
    const h = await openPaired();
    const { harness: make } = await import('./helpers');
    const fresh = make();
    for (const [k, v] of h.local.data) fresh.local.data.set(k, v);
    for (const [k, v] of h.session.data) fresh.session.data.set(k, v);
    fresh.clock.t = h.clock.t + 60_000;
    await fresh.worker.vault.restore();
    expect(await fresh.worker.vault.state()).toBe('open');

    const late = make();
    for (const [k, v] of h.local.data) late.local.data.set(k, v);
    for (const [k, v] of h.session.data) late.session.data.set(k, v);
    late.clock.t = h.clock.t + 31 * 60_000;
    await late.worker.vault.restore();
    expect(await late.worker.vault.state()).toBe('locked');
    expect(late.session.data.has(SESSION_KEY)).toBe(false);
  });
});
