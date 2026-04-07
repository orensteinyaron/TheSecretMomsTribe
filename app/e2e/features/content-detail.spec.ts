import { test, expect } from '@playwright/test';

test.describe('Content Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const row = page.locator('main').locator('button.truncate').first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    await page.waitForURL(/\/pipeline\/.+/, { timeout: 10000 });
    await page.waitForTimeout(1000);
  });

  test('shows hook section', async ({ page }) => {
    await expect(page.locator('[data-testid="section-hook"]')).toBeVisible();
  });

  test('shows caption section', async ({ page }) => {
    await expect(page.locator('[data-testid="section-caption"]')).toBeVisible();
  });

  test('shows hashtags', async ({ page }) => {
    await expect(page.locator('[data-testid="section-hashtags"]')).toBeVisible();
  });

  test('shows details panel', async ({ page }) => {
    await expect(page.locator('[data-testid="panel-details"]')).toBeVisible();
  });

  test('shows render panel', async ({ page }) => {
    await expect(page.locator('[data-testid="panel-render"]')).toBeVisible();
  });

  test('back button navigates to pipeline', async ({ page }) => {
    await page.locator('main').locator('button').first().click();
    await expect(page).toHaveURL('/pipeline');
  });

  test('metadata badges render correctly', async ({ page }) => {
    await expect(page.locator('main [class*="rounded-full"]').first()).toBeVisible();
  });
});
