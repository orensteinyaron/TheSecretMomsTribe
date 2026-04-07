import { test, expect } from '@playwright/test';

test.describe('Render Queue', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/renders');
    await page.waitForTimeout(1500);
  });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Render Queue' })).toBeVisible();
  });

  test('shows three kanban columns', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.locator('h2').filter({ hasText: 'PENDING' })).toBeVisible();
    await expect(main.locator('h2').filter({ hasText: 'RENDERING' })).toBeVisible();
    await expect(main.locator('h2').filter({ hasText: 'FAILED' })).toBeVisible();
  });

  test('pending column shows count', async ({ page }) => {
    await expect(page.locator('[data-testid="column-pending"]')).toBeVisible();
  });
});
