import { test, expect } from '@playwright/test';

test.describe('Full Content Lifecycle', () => {
  test('content detail shows all expected sections', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(2000);
    const firstRow = page.locator('main button.truncate').first();
    await firstRow.waitFor({ state: 'visible', timeout: 10000 });
    await firstRow.click();
    await page.waitForURL(/\/pipeline\/.+/);
    await page.waitForTimeout(1500);

    // All sections present
    const main = page.locator('main');
    await expect(main.getByText('HOOK', { exact: true })).toBeVisible();
    await expect(main.getByText('CAPTION', { exact: true })).toBeVisible();
    await expect(main.getByText('DETAILS', { exact: true })).toBeVisible();
    await expect(main.getByText('RENDER', { exact: true })).toBeVisible();
    await expect(main.getByText('Platform', { exact: true })).toBeVisible();
    await expect(main.getByText('Format', { exact: true })).toBeVisible();
  });

  test('render queue shows kanban columns', async ({ page }) => {
    await page.goto('/renders');
    await page.waitForTimeout(1500);
    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: 'Render Queue' })).toBeVisible();
    await expect(main.locator('h2').filter({ hasText: 'PENDING' })).toBeVisible();
    await expect(main.locator('h2').filter({ hasText: 'RENDERING' })).toBeVisible();
    await expect(main.locator('h2').filter({ hasText: 'FAILED' })).toBeVisible();
  });

  test('planner shows week view with gap detection', async ({ page }) => {
    await page.goto('/planner');
    await page.waitForTimeout(1500);
    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: 'Planner' })).toBeVisible();
    // Week navigation
    await expect(main.getByText('MON', { exact: true })).toBeVisible();
    await expect(main.getByText('SUN', { exact: true })).toBeVisible();
    // Gap detection
    const gapBadge = main.getByText(/\d+ gap/);
    await expect(gapBadge).toBeVisible();
  });

  test('research briefings show opportunities', async ({ page }) => {
    await page.goto('/research');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Research Briefings' })).toBeVisible();
    // Should have at least the date and opportunities count
    await expect(page.locator('main').getByText('Opportunities:', { exact: false })).toBeVisible();
  });

  test('analytics shows charts and metrics', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(page.locator('main').getByText('TOTAL CONTENT', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText('APPROVAL RATE', { exact: true })).toBeVisible();
  });

  test('notifications page shows actionable items', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    // Should show derived notifications or "All clear"
    const hasNotifications = await page.locator('main').getByText(/awaiting review|pending|failed/i).isVisible().catch(() => false);
    if (!hasNotifications) {
      await expect(page.locator('main').getByText('All clear', { exact: false })).toBeVisible();
    }
  });

  test('settings page shows configuration sections', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('main').getByText('Posting Cadence', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText('Content Mix Targets', { exact: true })).toBeVisible();
    await expect(page.locator('main').getByText('API Connections', { exact: true })).toBeVisible();
  });

  test('activity log page renders', async ({ page }) => {
    await page.goto('/activity');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Activity Log' })).toBeVisible();
  });

  test('sidebar navigation works for all routes', async ({ page }) => {
    const routes = [
      { link: 'Dashboard', url: '/' },
      { link: 'Content Pipeline', url: '/pipeline' },
      { link: 'Strategy Tasks', url: '/strategy' },
      { link: 'Research', url: '/research' },
      { link: 'Planner', url: '/planner' },
      { link: 'Render Queue', url: '/renders' },
      { link: 'Analytics', url: '/analytics' },
      { link: 'Activity Log', url: '/activity' },
      { link: 'Agents', url: '/system/agents' },
      { link: 'Services', url: '/system/services' },
      { link: 'Render Profiles', url: '/system/profiles' },
      { link: 'Directives', url: '/system/directives' },
      { link: 'Costs', url: '/system/costs' },
      { link: 'Notifications', url: '/notifications' },
      { link: 'Settings', url: '/settings' },
    ];

    await page.goto('/');
    await page.waitForTimeout(1500);
    for (const route of routes) {
      await page.getByRole('link', { name: route.link, exact: true }).click();
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(route.url);
    }
  });
});
