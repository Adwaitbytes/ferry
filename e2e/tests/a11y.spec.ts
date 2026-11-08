import { CASHEW, LISBON, TYPESCRIPT, VEGETARIAN_CONFLICT, pairedSeed } from '../support/data';
import { expect, test } from '../support/test';

/** Every web screen, in the state a judge sees it: paired, with memory, wallet connected where it matters. */
const SCREENS: { path: string; heading: string | RegExp; level?: number }[] = [
  { path: '/', heading: /./, level: 1 },
  // Onboarding has no page title, only the current step heading.
  { path: '/start', heading: /Connect your Sui wallet|What first\?/ },
  { path: '/rescue', heading: 'Rescue' },
  { path: '/library', heading: 'Library' },
  { path: '/desk', heading: 'Desk' },
  { path: '/devices', heading: 'Devices' },
  { path: '/share', heading: 'Share and Earn' },
  { path: '/proofs', heading: 'Proofs' },
  { path: '/settings', heading: 'Settings' },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Accessibility, ${theme} theme`, () => {
    for (const screen of SCREENS) {
      test(`${screen.path} has no serious or critical axe violations`, async ({ page, ferry }) => {
        await ferry.setup({ theme, wallet: true, extension: pairedSeed([CASHEW, LISBON, TYPESCRIPT, VEGETARIAN_CONFLICT]) });
        await page.goto(screen.path);
        await expect(page.getByRole('heading', { level: screen.level ?? (screen.path === '/start' ? 2 : 1), name: screen.heading }).first()).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // Let entrance transitions settle so contrast is measured on final colors.
        await page.waitForLoadState('networkidle');
        await ferry.expectAccessible(`${theme}${screen.path === '/' ? '-landing' : screen.path.replace('/', '-')}`);
      });
    }

    test('Library conflict and Desk blackout states have no serious or critical axe violations', async ({ page, ferry }) => {
      await ferry.setup({ theme, extension: pairedSeed([CASHEW, VEGETARIAN_CONFLICT]) });
      await page.goto('/library');
      await page.getByRole('tab', { name: /Conflicts/ }).click();
      await expect(page.getByRole('button', { name: 'Resolve conflict' })).toBeVisible();
      await ferry.expectAccessible(`${theme}-library-conflicts`);

      await page.getByRole('link', { name: 'Desk' }).click();
      await page.getByRole('button', { name: 'Plan dinner for Friday' }).click();
      await page.getByRole('button', { name: 'Cut off' }).click();
      await expect(page.getByText('facts lost')).toBeVisible();
      await ferry.expectAccessible(`${theme}-desk-blackout`);
    });
  });
}
