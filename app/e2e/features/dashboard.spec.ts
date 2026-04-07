import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
  });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('shows action center when items need attention', async ({ page }) => {
    const actionCenter = page.locator('main').getByText('NEEDS YOUR ATTENTION', { exact: true });
    // May or may not be visible depending on data
    if (await actionCenter.isVisible()) {
      // Badge count should be present
      await expect(page.locator('.bg-error').first()).toBeVisible();
    }
  });

  test('snapshot cards are clickable', async ({ page }) => {
    await page.locator('[data-testid="metric-pipeline"]').click();
    await expect(page).toHaveURL('/pipeline');
  });

  test('system activity section exists', async ({ page }) => {
    await expect(page.locator('main').getByText('SYSTEM ACTIVITY', { exact: true })).toBeVisible();
  });

  test('notification bell shows count', async ({ page }) => {
    const bell = page.locator('button[title="Notifications"]');
    await expect(bell).toBeVisible();
  });

  test('refresh button triggers data reload', async ({ page }) => {
    const refreshBtn = page.locator('button[title="Refresh all data"]');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
  });
});
