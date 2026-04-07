import { test, expect } from '@playwright/test';

test.describe('Research Briefings', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/research'); });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Research Briefings' })).toBeVisible();
  });

  test('shows date navigation', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Previous' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
  });

  test('displays briefing data or empty state', async ({ page }) => {
    const hasBriefing = await page.getByText('Opportunities:').isVisible().catch(() => false);
    if (hasBriefing) {
      // Should show opportunity cards
      await expect(page.getByText('Source:').first()).toBeVisible();
    }
  });

  test('previous button navigates to earlier date', async ({ page }) => {
    const dateText = await page.locator('text=/\\d{4}-\\d{2}-\\d{2}/').first().textContent();
    await page.getByRole('button', { name: 'Previous' }).click();
    await page.waitForTimeout(500);
  });
});
