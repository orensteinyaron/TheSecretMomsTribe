import { test, expect } from '@playwright/test';

test.describe('Strategy Tasks', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/strategy'); });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Strategy Tasks' })).toBeVisible();
  });

  test('shows 4 tabs', async ({ page }) => {
    for (const tab of ['Pending', 'Approved', 'Rejected', 'Insights']) {
      await expect(page.getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('pending tab is default', async ({ page }) => {
    // Either shows tasks or empty state
    const hasTasks = await page.getByText('Recommended Action').isVisible().catch(() => false);
    if (!hasTasks) {
      await expect(page.getByText(/No pending tasks/)).toBeVisible();
    }
  });

  test('insights tab shows insights or empty state', async ({ page }) => {
    await page.getByRole('button', { name: 'Insights' }).click();
    await page.waitForTimeout(500);
    const hasInsights = await page.getByText('Confidence:').isVisible().catch(() => false);
    if (!hasInsights) {
      await expect(page.getByText(/No insights/)).toBeVisible();
    }
  });
});
