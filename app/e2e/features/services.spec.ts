import { test, expect } from '@playwright/test';

test.describe('Services', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/system/services');
    await page.waitForTimeout(1500);
  });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
  });

  test('shows service table headers', async ({ page }) => {
    await expect(page.locator('[data-testid="services-table"]')).toBeVisible();
  });

  test('shows active and no_key statuses', async ({ page }) => {
    const table = page.locator('[data-testid="services-table"]');
    await expect(table.getByText('ACTIVE', { exact: true }).first()).toBeVisible();
    await expect(table.getByText('NO KEY', { exact: true }).first()).toBeVisible();
  });
});
