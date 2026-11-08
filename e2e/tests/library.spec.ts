import { CASHEW, VEGETARIAN_CONFLICT, pairedSeed } from '../support/data';
import { STORAGE } from '../support/protocol';
import { expect, test } from '../support/test';

interface StoredState {
  items: { memory: { ref: string; text: string; status: string; supersededBy: string | null } }[];
}

const readState = (page: import('@playwright/test').Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as StoredState, STORAGE.extension);

test.describe('Conflict resolution in Library', () => {
  test('keeping the newer fact supersedes the older one and empties the inbox', async ({ page, ferry }) => {
    await ferry.setup({ extension: pairedSeed([CASHEW, VEGETARIAN_CONFLICT]) });
    await page.goto('/library');

    await page.getByRole('tab', { name: /Conflicts/ }).click();
    const card = page.getByRole('article').filter({ hasText: 'These two facts disagree' });
    await expect(card).toContainText('Vegetarian.');
    await expect(card).toContainText('Eats fish now, still no meat.');

    await card.getByRole('radio', { name: /Keep the newer one/ }).check();
    await card.getByRole('button', { name: 'Resolve conflict' }).click();
    await expect(page.getByText(/^Resolved\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No conflicts' })).toBeVisible();

    const state = await readState(page);
    const vegetarian = state.items.find((i) => i.memory.text === 'Vegetarian.');
    const fish = state.items.find((i) => i.memory.text === 'Eats fish now, still no meat.');
    expect(vegetarian?.memory.status).toBe('superseded');
    expect(fish?.memory.status).toBe('active');
    expect(vegetarian?.memory.supersededBy).toBe(fish?.memory.ref);
    expect((await ferry.extensionLog()).filter((e) => e.type === 'memory.resolve')).toHaveLength(1);
  });

  test('merging writes one fact in the user words', async ({ page, ferry }) => {
    await ferry.setup({ extension: pairedSeed([VEGETARIAN_CONFLICT]) });
    await page.goto('/library');
    await page.getByRole('tab', { name: /Conflicts/ }).click();
    const card = page.getByRole('article').filter({ hasText: 'These two facts disagree' });
    await card.getByRole('radio', { name: /Merge into one fact/ }).check();
    await card.getByRole('textbox', { name: 'Merged fact' }).fill('Pescatarian since October 2026.');
    await card.getByRole('button', { name: 'Resolve conflict' }).click();
    await expect(page.getByRole('heading', { name: 'No conflicts' })).toBeVisible();
    const state = await readState(page);
    expect(state.items.find((i) => i.memory.text === 'Pescatarian since October 2026.')?.memory.status).toBe('active');
  });
});

test.describe('Delete (hide) from Library', () => {
  test('hiding a fact moves it to Hidden and explains the storage epoch', async ({ page, ferry }) => {
    await ferry.setup({ extension: pairedSeed() });
    await page.goto('/library');
    const row = page.getByRole('article', { name: 'Lives in Lisbon.' });
    await row.getByRole('button', { name: 'Hide this fact' }).click();
    const dialog = page.getByRole('dialog', { name: 'Hide this fact?' });
    await expect(dialog).toContainText('Walrus Memory has no delete');
    await dialog.getByRole('button', { name: 'Hide fact' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('tab', { name: /Hidden/ }).click();
    await expect(page.getByRole('article', { name: 'Lives in Lisbon.' })).toBeVisible();
    const state = await readState(page);
    expect(state.items.find((i) => i.memory.text === 'Lives in Lisbon.')?.memory.status).toBe('hidden');
  });
});
