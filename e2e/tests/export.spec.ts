/* eslint-disable security/detect-non-literal-fs-filename -- every path comes from support/paths.ts or Playwright's own download dir, never from input */
import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { pairedSeed } from '../support/data';
import { expect, test } from '../support/test';

async function exportVia(page: Page, button: string): Promise<{ download: Download; text: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
  const path = await download.path();
  return { download, text: await readFile(path, 'utf8') };
}

test.describe('Export and delete', () => {
  test('Settings exports every active fact as PAM JSON and as Markdown, built on this device', async ({ page, ferry }) => {
    await ferry.setup({ extension: pairedSeed() });
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Export and leave' })).toBeVisible();

    const json = await exportVia(page, 'Export JSON (PAM compatible)');
    expect(json.download.suggestedFilename()).toMatch(/^ferry-memory-\d{4}-\d{2}-\d{2}\.json$/);
    const pam = JSON.parse(json.text) as unknown;
    const serialized = JSON.stringify(pam);
    for (const fact of ['Allergic to cashews.', 'Lives in Lisbon.', 'Writes TypeScript at work.']) expect(serialized).toContain(fact);
    await expect(page.getByText('Exported 3 facts.')).toBeVisible();

    const md = await exportVia(page, 'Export Markdown');
    expect(md.download.suggestedFilename()).toMatch(/\.md$/);
    expect(md.text).toContain('# My memory, exported from Ferry');
    expect(md.text).toContain('Allergic to cashews');

    expect((await ferry.extensionLog()).filter((e) => e.type === 'data.export')).toHaveLength(2);
  });

  test('a hidden fact is left out of the next export', async ({ page, ferry }) => {
    await ferry.setup({ extension: pairedSeed() });
    await page.goto('/library');
    await page.getByRole('article', { name: 'Lives in Lisbon.' }).getByRole('button', { name: 'Hide this fact' }).click();
    await page.getByRole('dialog', { name: 'Hide this fact?' }).getByRole('button', { name: 'Hide fact' }).click();
    await expect(page.getByRole('dialog', { name: 'Hide this fact?' })).toBeHidden();

    await page.goto('/settings');
    const md = await exportVia(page, 'Export Markdown');
    expect(md.text).toContain('Allergic to cashews');
    expect(md.text).not.toContain('Lives in Lisbon');
  });

  test('local wipe stays in the side panel: the web app offers no delete-all control', async ({ page, ferry }) => {
    await ferry.setup({ extension: pairedSeed() });
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Delete local data' })).toBeVisible();
    await expect(page.getByRole('button', { name: /delete|wipe/i })).toHaveCount(0);
  });
});
