import { pairedSeed } from '../support/data';
import { expect, test } from '../support/test';

test.describe('Blackout Drill', () => {
  test('cutting off Claude continues on GPT with the same memory and 0 facts lost', async ({ page, ferry }) => {
    const mocks = await ferry.setup({ extension: pairedSeed() });
    await page.goto('/desk');

    await expect(page.getByRole('radiogroup', { name: 'Model' })).toBeVisible();
    await page.getByRole('button', { name: 'Plan dinner for Friday' }).click();

    const conversation = page.getByRole('region', { name: 'Conversation' });
    await expect(conversation.getByText('Answer from claude.')).toBeVisible();
    await expect(conversation.getByText('Used 3 memories')).toBeVisible();

    await page.getByRole('button', { name: 'Cut off' }).click();
    await expect(conversation.getByText('This simulates Claude cutting you off.')).toBeVisible();
    await expect(conversation.getByText('Continuing on GPT')).toBeVisible();

    const result = page.getByRole('complementary', { name: 'Memory used in this reply' });
    await expect(result.getByText('facts lost')).toBeVisible();
    await expect(result).toContainText(/0\s*facts lost/);
    await expect(result).toContainText('Same 3 facts, now answering on GPT.');
    await expect(page.getByRole('radio', { name: 'Claude' })).toBeDisabled();

    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('What should I pack for Lisbon');
    await composer.press('Enter');
    await expect(conversation.getByText('Answer from gpt.')).toBeVisible();

    expect(mocks.deskRequests).toHaveLength(2);
    const [before, after] = mocks.deskRequests;
    expect(before).toMatchObject({ provider: 'claude', cutOff: [], servedBy: 'claude' });
    expect(after).toMatchObject({ provider: 'gpt', cutOff: ['claude'], servedBy: 'gpt' });
    expect([...(after?.contextRefs ?? [])].sort()).toEqual([...(before?.contextRefs ?? [])].sort());
  });
});
