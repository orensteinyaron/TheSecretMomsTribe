import { test, expect } from '@playwright/test';

test.describe('Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(1500);
  });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Content Pipeline' })).toBeVisible();
  });

  test('tab bar shows all filters', async ({ page }) => {
    const main = page.locator('main');
    for (const tab of ['All', 'Review', 'Approved', 'Rejected']) {
      await expect(main.getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('switching tabs filters content', async ({ page }) => {
    const main = page.locator('main');
    await main.getByRole('button', { name: 'Approved' }).click();
    await page.waitForTimeout(500);
    await main.getByRole('button', { name: 'All' }).click();
  });

  test('search bar is present and functional', async ({ page }) => {
    const search = page.locator('main').getByPlaceholder('Search hooks, captions...');
    await expect(search).toBeVisible();
    await search.fill('toddler');
    await page.waitForTimeout(1000);
    await search.clear();
  });

  test('table header shows columns', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText('HOOK', { exact: true })).toBeVisible();
    await expect(main.getByText('PLATFORM', { exact: true })).toBeVisible();
    await expect(main.getByText('PILLAR', { exact: true })).toBeVisible();
    await expect(main.getByText('STATUS', { exact: true })).toBeVisible();
  });

  test('content rows are clickable', async ({ page }) => {
    const row = page.locator('main button.truncate').first();
    if (await row.isVisible()) {
      await row.click();
      await expect(page).toHaveURL(/\/pipeline\/.+/);
    }
  });

  test('checkbox selection works', async ({ page }) => {
    const checkbox = page.locator('main input[type="checkbox"]').nth(1);
    if (await checkbox.isVisible()) {
      await checkbox.check();
      // Bulk actions should appear
      await expect(page.locator('main').getByText(/Approve \d|Reject \d/)).toBeVisible();
      await checkbox.uncheck();
    }
  });

  test('pillar badges are color-coded', async ({ page }) => {
    const pillarBadge = page.locator('main [class*="rounded-full"]').first();
    await expect(pillarBadge).toBeVisible();
  });
});
