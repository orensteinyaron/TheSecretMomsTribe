import { test, expect } from '@playwright/test';

test.describe('Content Feedback Flow', () => {
  test('admin uses inline edit on hook', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const firstRow = page.locator('main button.truncate').first();
    await firstRow.waitFor({ state: 'visible', timeout: 10000 });
    await firstRow.click();
    await page.waitForURL(/\/pipeline\/.+/);
    await page.waitForTimeout(1500);

    // Find the hook section and click to edit
    const hookSection = page.locator('main').getByText('HOOK', { exact: true }).locator('..');
    await hookSection.click();
    // Should show edit input or the editable field
    await page.waitForTimeout(500);
  });

  test('admin views content detail with all sections', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const firstRow = page.locator('main button.truncate').first();
    await firstRow.waitFor({ state: 'visible', timeout: 10000 });
    await firstRow.click();
    await page.waitForURL(/\/pipeline\/.+/);
    await page.waitForTimeout(1500);

    // Verify sections
    const main = page.locator('main');
    await expect(main.getByText('HOOK', { exact: true })).toBeVisible();
    await expect(main.getByText('CAPTION', { exact: true })).toBeVisible();
    await expect(main.getByText('HASHTAGS', { exact: true })).toBeVisible();
    await expect(main.getByText('DETAILS', { exact: true })).toBeVisible();
    await expect(main.getByText('RENDER', { exact: true })).toBeVisible();
  });

  test('admin can navigate back to pipeline', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const firstRow = page.locator('main button.truncate').first();
    await firstRow.waitFor({ state: 'visible', timeout: 10000 });
    await firstRow.click();
    await page.waitForURL(/\/pipeline\/.+/);
    await page.waitForTimeout(1500);

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
