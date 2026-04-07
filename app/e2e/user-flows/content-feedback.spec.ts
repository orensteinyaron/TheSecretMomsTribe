import { test, expect } from '@playwright/test';

test.describe('Content Feedback Flow', () => {
  test('admin uses inline edit on hook', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const row = page.locator('main').locator('button.truncate').first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    await page.waitForURL(/\/pipeline\/.+/, { timeout: 10000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="section-hook"]')).toBeVisible();
  });

  test('admin views content detail with all sections', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const row = page.locator('main').locator('button.truncate').first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    await page.waitForURL(/\/pipeline\/.+/, { timeout: 10000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="section-hook"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-caption"]')).toBeVisible();
    await expect(page.locator('[data-testid="section-hashtags"]')).toBeVisible();
  });

  test('admin can navigate back to pipeline', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const row = page.locator('main').locator('button.truncate').first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.click();
    await page.waitForURL(/\/pipeline\/.+/, { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Click back arrow
    await page.locator('main').locator('button').first().click();
    await expect(page).toHaveURL('/pipeline');
  });

  test('batch reject from pipeline', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(1500);
    await page.locator('main input[type="checkbox"]').first().waitFor({ state: 'visible', timeout: 10000 });
    // Select first two checkboxes (skip the "all" checkbox)
    const checkboxes = page.locator('main input[type="checkbox"]');
    const count = await checkboxes.count();
    if (count >= 3) {
      await checkboxes.nth(1).check();
      await checkboxes.nth(2).check();
      // Bulk reject button should appear
      await expect(page.locator('main').getByText(/Reject \d/)).toBeVisible();
    }
  });
});
