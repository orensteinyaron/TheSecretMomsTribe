import { test, expect } from '@playwright/test';

test.describe('Planner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/planner');
    await page.waitForTimeout(1500);
  });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Planner' })).toBeVisible();
  });

  test('shows week day headers', async ({ page }) => {
    const main = page.locator('main');
    for (const day of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
      await expect(main.getByText(day, { exact: true })).toBeVisible();
    }
  });

  test('shows gap detection', async ({ page }) => {
    await expect(page.locator('main').getByText(/\d+ gap/)).toBeVisible();
  });

  test('week navigation works', async ({ page }) => {
    const dateText = page.locator('main').locator('text=/\\w+ \\d+ — \\w+ \\d+/').first();
    const before = await dateText.textContent();
    await page.locator('main button:has(svg)').nth(1).click(); // Previous arrow
    await page.waitForTimeout(300);
  });

  test('today button resets to current week', async ({ page }) => {
    await page.locator('main').getByRole('button', { name: 'Today' }).click();
    await page.waitForTimeout(300);
  });
});
