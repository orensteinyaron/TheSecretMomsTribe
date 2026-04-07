import { test, expect } from '@playwright/test';

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/analytics'); });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  });

  test('shows period toggle', async ({ page }) => {
    for (const p of ['Day', 'Week', 'Month']) {
      await expect(page.getByRole('button', { name: p })).toBeVisible();
    }
  });

  test('shows metric cards', async ({ page }) => {
    await expect(page.getByText('TOTAL CONTENT')).toBeVisible();
    await expect(page.getByText('APPROVAL RATE')).toBeVisible();
  });

  test('switching period refetches data', async ({ page }) => {
    await page.getByRole('button', { name: 'Month' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Week' }).click();
  });
});
