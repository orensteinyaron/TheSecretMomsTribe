import { test, expect } from '@playwright/test';

test.describe('Strategy Approval Flow', () => {
  test('strategy page shows tabs', async ({ page }) => {
    await page.goto('/strategy');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Strategy Tasks' })).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByRole('button', { name: 'Pending' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Approved' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Rejected' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Insights' })).toBeVisible();
  });

  test('insights tab shows insights with confidence', async ({ page }) => {
    await page.goto('/strategy');
    await page.waitForTimeout(1500);
    await page.locator('main').getByRole('button', { name: 'Insights' }).click();
    await page.waitForTimeout(500);
    // Either shows insights or empty state
    const hasInsights = await page.locator('main').getByText('Confidence:', { exact: false }).isVisible().catch(() => false);
    if (!hasInsights) {
      await expect(page.locator('main').getByText(/No insights/i)).toBeVisible();
    }
  });

  test('navigate from strategy to directives', async ({ page }) => {
    await page.goto('/strategy');
    await page.waitForTimeout(1500);
    await page.goto('/system/directives');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'System Directives' })).toBeVisible();
    await expect(page.locator('main').getByText('Create Directive', { exact: true })).toBeVisible();
  });

  test('create a directive', async ({ page }) => {
    await page.goto('/system/directives');
    await page.waitForTimeout(1500);
    // Fill the directive form
    const main = page.locator('main');
    await main.locator('textarea').fill('E2E test directive: increase AI magic to 35%');
    // Select type
    await main.locator('select').selectOption('content_mix');
    // Click Create
    await main.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1000);
    // Should appear in the list (switch to 'all' tab to see pending)
    await main.getByRole('button', { name: 'All' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('main').getByText('E2E test directive', { exact: false })).toBeVisible();
  });
});
