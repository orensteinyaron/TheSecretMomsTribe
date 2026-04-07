import { test, expect } from '@playwright/test';

test.describe('Morning Review Flow', () => {
  test('admin sees dashboard with action center', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await expect(page.getByText('NEEDS YOUR ATTENTION')).toBeVisible();
    await expect(page.getByText('PIPELINE', { exact: true })).toBeVisible();
    await expect(page.getByText("TODAY'S COST")).toBeVisible();
  });

  test('admin navigates from dashboard to pipeline', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const contentLink = page.getByText(/content item.*awaiting review/i);
    if (await contentLink.isVisible()) {
      await contentLink.click();
      await expect(page).toHaveURL('/pipeline');
    }
  });

  test('admin approves content from pipeline', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(1500);
    const approveBtn = page.locator('button[title="Approve"]').first();
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      await page.waitForTimeout(1000);
    }
  });

  test('admin rejects content with structured reason', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForTimeout(1500);
    const rejectBtn = page.locator('button[title="Reject"]').first();
    if (await rejectBtn.isVisible()) {
      await rejectBtn.click();
      await expect(page.getByText('Reject Content')).toBeVisible();
      await page.getByText('Weak Hook').click();
      await page.locator('button:has-text("Reject")').last().click();
      await page.waitForTimeout(500);
    }
  });

  test('dashboard activity log shows entries', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await expect(page.getByText('SYSTEM ACTIVITY')).toBeVisible();
  });
});
