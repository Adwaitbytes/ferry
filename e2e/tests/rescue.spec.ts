/* eslint-disable security/detect-non-literal-fs-filename -- every path comes from support/paths.ts or Playwright's own download dir, never from input */
import { readFileSync } from 'node:fs';
import { pairedSeed } from '../support/data';
import { paths } from '../support/paths';
import { STORAGE } from '../support/protocol';
import { expect, test } from '../support/test';

interface StoredState {
  items: { memory: { text: string; status: string } }[];
}

test.describe('Rescue', () => {
  test('imports a ChatGPT export ZIP, reviews it, writes to Walrus and shows the hero metric', async ({ page, ferry }) => {
    const mocks = await ferry.setup({ extension: { ...pairedSeed([]), writesPerPoll: 2 } });
    await page.goto('/rescue');

    await page.getByRole('button', { name: 'ChatGPT export' }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'chatgpt-export.zip',
      mimeType: 'application/zip',
      buffer: readFileSync(paths.chatgptZip),
    });

    // Review: 5 ordinary facts and 1 health fact found; the injected instruction is quarantined.
    await expect(page.getByText('facts found. Approve the ones that are true.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^6$/).first()).toBeVisible();
    const groups = page.getByRole('navigation', { name: 'Fact groups' });
    await expect(groups.getByRole('button', { name: /Quarantined\s*1/ })).toBeVisible();
    await expect(groups.getByRole('button', { name: /Sensitive, off by default\s*1/ })).toBeVisible();
    expect(mocks.distillRequests).toBeGreaterThan(0);

    await groups.getByRole('button', { name: /Quarantined/ }).click();
    await expect(page.getByText('These looked like instructions to an AI, not facts about you. They will not be saved.')).toBeVisible();

    // Discard one preference, with an undo toast.
    await groups.getByRole('button', { name: /^Preference/ }).click();
    const rust = page.getByRole('article').filter({ hasText: 'Favourite programming language is Rust.' });
    await rust.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByText('Discarded.')).toBeVisible();

    const move = page.getByRole('button', { name: 'Move 4 facts to Walrus' });
    await expect(move).toBeEnabled();
    await move.click();

    await expect(page.getByRole('progressbar', { name: 'Moving facts to Walrus' })).toBeVisible();
    const hero = page.getByRole('heading', { name: /ChatGPT knew 6 things about you\./ });
    await expect(hero).toBeVisible({ timeout: 30_000 });
    // Counters render a visual and a screen reader copy, so assert on the accessible name.
    await expect(hero).toHaveAccessibleName(/You owned 0\.\s*Now you own 4\s?\./);

    const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as StoredState, STORAGE.extension);
    const written = state.items.map((i) => i.memory.text).sort();
    expect(written).toEqual([
      'Building a budgeting app for students.',
      'Partner Sam is allergic to cats.',
      'Prefers drives of three hours or less.',
      'Runs every Tuesday and Thursday morning before work.',
    ]);
    // Sensitive stays out unless included; quarantined and discarded facts are never written.
    expect(written.join(' ')).not.toMatch(/knee|Ignore previous instructions|Rust/);

    await page.getByRole('link', { name: 'Open Library' }).click();
    await expect(page.getByRole('article', { name: 'Partner Sam is allergic to cats.' })).toBeVisible();
  });

  test('a ZIP without conversations.json gets a plain-language error', async ({ page, ferry }) => {
    await ferry.setup({ extension: pairedSeed([]) });
    await page.goto('/rescue');
    await page.getByRole('button', { name: 'ChatGPT export' }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip at all') });
    await expect(page.getByRole('alert').filter({ hasText: /not a ZIP file|damaged/ })).toBeVisible();
  });
});
