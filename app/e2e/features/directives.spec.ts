import { test, expect } from '@playwright/test';

test.describe('Directives', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/system/directives');
    await page.waitForTimeout(1500);
  });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'System Directives' })).toBeVisible();
  });

  test('shows create form', async ({ page }) => {
    await expect(page.locator('main').getByText('Create Directive', { exact: true })).toBeVisible();
    await expect(page.locator('main textarea')).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Create' })).toBeVisible();
  });

  test('shows tabs', async ({ page }) => {
    const main = page.locator('main');
    for (const tab of ['Active', 'Pending', 'All']) {
      await expect(main.getByRole('button', { name: tab })).toBeVisible();
    }
  });
});
