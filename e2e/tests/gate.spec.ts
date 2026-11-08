import { GateRecallResult } from '@ferry/core';
import { pairedSeed } from '../support/data';
import { GATE_CONTROL_PORT, GATE_PORT } from '../support/protocol';
import { expect, test } from '../support/test';

/*
 * The real Gate app over HTTP (servers/gate-server.ts): PGlite Postgres, real MPP challenge and
 * credential (suimpp), real replay gate. Only the Tatum read and the public recall are the Gate
 * test rig's fakes. Runs serially because the rig holds one in-memory database: the last test
 * signs in to that same Gate from the web app and sees the payment the first tests made.
 */
const GATE = `http://127.0.0.1:${GATE_PORT}`;
const CONTROL = `http://127.0.0.1:${GATE_CONTROL_PORT}`;
const CARD_ID = 'q3V7mT0xR9bK2wY5pL8nAg';

test.describe.serial('Gate paid recall (local Gate on PGlite)', () => {
  test.beforeAll(async ({ request }) => {
    expect((await request.post(`${CONTROL}/reset`)).ok()).toBe(true);
  });

  test('public card metadata is readable without payment', async ({ request }) => {
    const res = await request.get(`${GATE}/v1/cards/${CARD_ID}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Food' });
  });

  test('unpaid recall gets 402 with an MPP challenge; paying once serves facts; a replay gets 409', async ({ request }) => {
    const url = `${GATE}/v1/cards/${CARD_ID}/recall`;
    const challenge = await request.post(url, { data: { q: 'food preferences' } });
    expect(challenge.status()).toBe(402);
    expect(challenge.headers()['www-authenticate']).toMatch(/^Payment /);
    const challengeBody = await challenge.text();
    expect(JSON.parse(challengeBody)).toMatchObject({ error: 'payment_required', mpp: { amountMicros: '10000' } });

    // The control port plays TripScout: it signs a credential for this exact challenge.
    const paid = await request.post(`${CONTROL}/pay`, { data: { status: challenge.status(), headers: challenge.headers(), body: challengeBody } });
    const { authorization } = (await paid.json()) as { authorization: string };

    const served = await request.post(url, { data: { q: 'food preferences' }, headers: { authorization } });
    expect(served.status()).toBe(200);
    expect(served.headers()['payment-receipt']).toBeTruthy();
    const result = GateRecallResult.parse(await served.json());
    expect(result.payment).toMatchObject({ amountMicros: '10000' });
    expect(result.results[0]?.text).toContain('cashews');

    const replay = await request.post(url, { data: { q: 'food preferences' }, headers: { authorization } });
    expect(replay.status()).toBe(409);
    expect(await replay.json()).toEqual({ error: 'payment_replayed' });

    const state = (await (await request.get(`${CONTROL}/state`)).json()) as { recallCalls: number; logs: string[] };
    expect(state.recallCalls).toBe(1);
    // Logs carry ids and statuses only, never the query text.
    expect(state.logs.join('\n')).not.toContain('food preferences');
  });

  test('Share and Earn signs in to Gate with the wallet and shows the paid recall', async ({ page, ferry }) => {
    await ferry.setup({ extension: pairedSeed(), wallet: true });
    await page.goto('/share');
    await expect(page.getByRole('heading', { name: 'Share and Earn', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Connect Ferry CI Mock Wallet' }).first().click();
    await page.getByRole('button', { name: 'Sign in to Ferry Gate' }).first().click();

    const table = page.getByRole('table', { name: 'Paid recalls of your Share Cards' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('cell', { name: 'Food' })).toBeVisible();
    await expect(table.getByRole('cell', { name: '0.01 USDC' })).toBeVisible();
    expect((await ferry.walletLog()).map((e) => e.feature)).toEqual(['sui:signPersonalMessage']);
  });
});
