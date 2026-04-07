import { test, expect } from '@playwright/test';

test.describe('Costs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/system/costs');
    await page.waitForTimeout(1500);
  });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Costs' })).toBeVisible();
  });

  test('shows period toggle', async ({ page }) => {
    for (const p of ['Day', 'Week', 'Month']) {
      await expect(page.locator('main').getByRole('button', { name: p })).toBeVisible();
    }
  });

  test('shows cost metric cards', async ({ page }) => {
    await expect(page.locator('main').getByText(/TOTAL/, { exact: false })).toBeVisible();
    await expect(page.locator('main').getByText('DAILY AVG', { exact: true })).toBeVisible();
  });
});
