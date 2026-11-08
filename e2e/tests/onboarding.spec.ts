import { keyFingerprint } from '@ferry/core';
import { unpairedSeed } from '../support/data';
import { ACCOUNT_ID } from '../support/protocol';
import { expect, test } from '../support/test';

test.describe('Onboarding and pairing (CI mock wallet)', () => {
  test('connects a wallet, creates the memory account, pairs this browser and picks a first move', async ({ page, ferry }) => {
    const seed = unpairedSeed();
    await ferry.setup({ extension: seed, wallet: true, accountMissingFor: 1 });
    await page.goto('/start');

    await expect(page.getByRole('heading', { name: 'Connect your Sui wallet' })).toBeVisible();
    await page.getByRole('button', { name: 'Connect Ferry CI Mock Wallet' }).click();

    await expect(page.getByRole('heading', { name: 'Your memory account' })).toBeVisible();
    await page.getByRole('button', { name: 'Create memory account' }).click();

    await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(keyFingerprint(seed.publicKeyHex), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pair this browser' }).click();

    // After pairing.confirm the status refresh already reports paired, so the page moves straight to
    // the first move step (the "Paired." line is skipped; logged in STATUS.md as a UX nit).
    await expect(page.getByRole('heading', { name: 'What first?' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Pair this browser' })).toContainText('done');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/rescue$/);

    const signed = await ferry.walletLog();
    expect(signed.map((s) => s.feature)).toEqual(['sui:signAndExecuteTransaction', 'sui:signAndExecuteTransaction']);
    expect(signed[0]?.transaction ?? '').toContain('create_account');
    expect(signed[1]?.transaction ?? '').toContain('add_delegate_key');
    // The key the wallet is asked to register is exactly the extension's key, not one the page made up.
    const keyBytes = Array.from(Buffer.from(seed.publicKeyHex, 'hex'));
    expect(signed[1]?.transaction ?? '').toContain(Buffer.from(Uint8Array.of(32, ...keyBytes)).toString('base64'));

    const requests = (await ferry.extensionLog()).map((r) => r.type);
    expect(requests).toContain('pairing.begin');
    expect(requests).toContain('pairing.confirm');
    const status = await page.evaluate(() => JSON.parse(localStorage.getItem('ferry-e2e:extension') ?? '{}') as { paired?: boolean; accountId?: string });
    expect(status).toMatchObject({ paired: true, accountId: ACCOUNT_ID });
  });

  test('a page without the extension gets the install screen, not a broken app', async ({ page, ferry }) => {
    await ferry.setup({ extension: null });
    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Ferry is not in this browser yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download Ferry for Chrome' })).toBeVisible();
  });

  test('a locked extension asks for the passphrase in the side panel', async ({ page, ferry }) => {
    await ferry.setup({ extension: { ...unpairedSeed(), locked: true } });
    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Ferry is locked' })).toBeVisible();
  });
});
