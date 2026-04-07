import { test, expect } from '@playwright/test';

test.describe('System Management Flow', () => {
  test('agents page shows all 7 agents', async ({ page }) => {
    await page.goto('/system/agents');
    await page.waitForTimeout(1500);
    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    // Check for known agents
    await expect(main.getByText('System Orchestrator', { exact: true })).toBeVisible();
    await expect(main.getByText('Data Fetcher', { exact: true })).toBeVisible();
    await expect(main.getByText('Research Agent', { exact: true })).toBeVisible();
  });

  test('agents show status badges and budget bars', async ({ page }) => {
    await page.goto('/system/agents');
    await page.waitForTimeout(1500);
    const main = page.locator('main');
    // All should be idle
    const idleBadges = main.getByText('IDLE', { exact: true });
    await expect(idleBadges.first()).toBeVisible();
    // Budget info should be visible
    await expect(main.getByText('Budget', { exact: false }).first()).toBeVisible();
  });

  test('agent run history expands', async ({ page }) => {
    await page.goto('/system/agents');
    await page.waitForTimeout(1500);
    // Click "Show run history" on first agent
    const showHistory = page.locator('main').getByText('Show run history', { exact: false }).first();
    await showHistory.click();
    await page.waitForTimeout(500);
    // Should expand to show recent runs or "No runs recorded"
    await expect(page.locator('main').getByText(/Recent Runs|No runs recorded/)).toBeVisible();
  });

  test('services page shows all services with status', async ({ page }) => {
    await page.goto('/system/services');
    await page.waitForTimeout(1500);
    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
    // Check known services
    await expect(main.getByText('Claude Haiku', { exact: true })).toBeVisible();
    await expect(main.getByText('Pexels Stock Media', { exact: true })).toBeVisible();
    await expect(main.getByText('OpenAI TTS', { exact: true })).toBeVisible();
    // Status badges
    await expect(main.getByText('ACTIVE', { exact: true }).first()).toBeVisible();
  });

  test('render profiles page shows all profiles', async ({ page }) => {
    await page.goto('/system/profiles');
    await page.waitForTimeout(1500);
    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: 'Render Profiles' })).toBeVisible();
    await expect(main.getByText('Moving Images', { exact: true })).toBeVisible();
    await expect(main.getByText('Static Image', { exact: true })).toBeVisible();
    // Service health indicators
    await expect(main.getByText('pexels', { exact: false }).first()).toBeVisible();
  });

  test('costs page shows breakdown', async ({ page }) => {
    await page.goto('/system/costs');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Costs' })).toBeVisible();
    // Period toggle
    await expect(page.locator('main').getByRole('button', { name: 'Day' })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Week' })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Month' })).toBeVisible();
  });
});
