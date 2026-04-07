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
    const main = page.locator('main');
    for (const h of ['NAME', 'TYPE', 'PROVIDER', 'STATUS']) {
      await expect(main.getByText(h, { exact: true })).toBeVisible();
    }
  });

  test('shows active and no_key statuses', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText('ACTIVE', { exact: true }).first()).toBeVisible();
    await expect(main.getByText('NO KEY', { exact: true }).first()).toBeVisible();
  });
});
