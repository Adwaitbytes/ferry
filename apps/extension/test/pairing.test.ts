import { describe, expect, it, vi } from 'vitest';
import { keyFingerprint } from '../src/lib/fingerprint';
import {
  ACCOUNT_ID,
  PASSPHRASE,
  PUBLIC_KEY,
  accountView,
  harness,
  panelSender,
  webSender,
} from './helpers';

async function opened() {
  const h = harness();
  await h.worker.vault.open(PASSPHRASE);
  return h;
}

describe('pairing', () => {
  it('begin needs a vault, then returns key, address and fingerprint', async () => {
    const h = harness();
    expect(await h.worker.route({ type: 'pairing.begin' }, webSender, 'external')).toMatchObject({
      ok: false,
      code: 'locked',
    });
    await h.worker.vault.open(PASSPHRASE);
    await h.worker.vault.lock();
    const res = await h.worker.route({ type: 'pairing.begin' }, webSender, 'external');
    expect(res).toEqual({
      ok: true,
      data: {
        publicKeyHex: PUBLIC_KEY,
        suiAddress: `0x${'cd'.repeat(32)}`,
        fingerprint: keyFingerprint(PUBLIC_KEY),
        label: 'Ferry on Chrome 9 Nov 2026',
        accountId: null,
      },
    });
    expect(keyFingerprint(PUBLIC_KEY)).toBe('abab abab abab abab');
  });

  it('confirm saves the account only when the chain proxy shows the key registered', async () => {
    const h = await opened();
    const res = await h.worker.route(
      { type: 'pairing.confirm', accountId: ACCOUNT_ID },
      webSender,
      'external',
    );
    expect(res).toEqual({
      ok: true,
      data: { accountId: ACCOUNT_ID, owner: `0x${'2'.repeat(64)}` },
    });
    expect(h.api.getAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(h.engines.created).toBe(1);
    const status = await h.worker.route({ type: 'status.get' }, panelSender, 'internal');
    expect(status).toMatchObject({
      ok: true,
      data: { lock: 'open', account: { accountId: ACCOUNT_ID } },
    });
  });

  it('accepts base64 delegate keys from the proxy', async () => {
    const h = await opened();
    const b64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 0xab)));
    h.api.getAccount = vi.fn(async () =>
      accountView({
        delegates: [{ publicKey: b64, suiAddress: '0x1', label: 'x', createdAt: null }],
      }),
    );
    expect(
      (
        await h.worker.route(
          { type: 'pairing.confirm', accountId: ACCOUNT_ID },
          webSender,
          'external',
        )
      ).ok,
    ).toBe(true);
  });

  it('refuses when the key is missing, the account is inactive, or the proxy returns another account', async () => {
    const cases = [
      accountView({
        delegates: [{ publicKey: 'cd'.repeat(32), suiAddress: '0x1', label: 'x', createdAt: null }],
      }),
      accountView({ active: false }),
      accountView({ accountId: `0x${'9'.repeat(64)}` }),
    ];
    for (const view of cases) {
      const h = await opened();
      h.api.getAccount = vi.fn(async () => view);
      const res = await h.worker.route(
        { type: 'pairing.confirm', accountId: ACCOUNT_ID },
        webSender,
        'external',
      );
      expect(res.ok).toBe(false);
      const status = await h.worker.route({ type: 'status.get' }, panelSender, 'internal');
      expect(status).toMatchObject({ ok: true, data: { account: null } });
    }
  });

  it('maps a chain proxy outage to upstream without leaking details', async () => {
    const h = await opened();
    h.api.getAccount = vi.fn(async () => {
      throw new Error('tatum key abc123 rejected');
    });
    const res = await h.worker.route(
      { type: 'pairing.confirm', accountId: ACCOUNT_ID },
      webSender,
      'external',
    );
    expect(res).toMatchObject({ ok: false, code: 'internal' });
    expect(JSON.stringify(res)).not.toContain('abc123');
  });
});
