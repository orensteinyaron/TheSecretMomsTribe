import { test, expect } from '@playwright/test';

test.describe('Content Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const row = page.locator('main button.truncate').first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    await page.waitForURL(/\/pipeline\/.+/);
    await page.waitForTimeout(1500);
  });

  test('shows hook section', async ({ page }) => {
    await expect(page.locator('main').getByText('HOOK', { exact: true })).toBeVisible();
  });

  test('shows caption section', async ({ page }) => {
    await expect(page.locator('main').getByText('CAPTION', { exact: true })).toBeVisible();
  });

  test('shows hashtags', async ({ page }) => {
    await expect(page.locator('main').getByText('HASHTAGS', { exact: true })).toBeVisible();
  });

  test('shows details panel', async ({ page }) => {
    await expect(page.locator('main').getByText('DETAILS', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText('Platform', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText('Format', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText('Age Range', { exact: true })).toBeVisible();
  });

  test('shows render panel', async ({ page }) => {
    await expect(page.locator('main').getByText('RENDER', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText('Status', { exact: true }).first()).toBeVisible();
  });

  test('back button navigates to pipeline', async ({ page }) => {
    await page.locator('main').locator('button').first().click();
    await expect(page).toHaveURL('/pipeline');
  });

  test('metadata badges render correctly', async ({ page }) => {
    // Platform, pillar, and status badges should be visible in header
    const badges = page.locator('main [class*="rounded-full"]');
    expect(await badges.count()).toBeGreaterThan(0);
  });
});
