import { test, expect } from '@playwright/test';

test.describe('Agents', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/system/agents'); });

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  });

  test('shows all 7 agents', async ({ page }) => {
    for (const name of ['System Orchestrator', 'Data Fetcher', 'Research Agent']) {
      await expect(page.getByText(name)).toBeVisible();
    }
  });

  test('agents show status badges', async ({ page }) => {
    await expect(page.getByText('IDLE').first()).toBeVisible();
  });

  test('run history toggle works', async ({ page }) => {
    await page.getByText('Show run history').first().click();
    await expect(page.getByText(/Recent Runs|No runs recorded/)).toBeVisible();
    await page.getByText('Hide run history').first().click();
  });
});
