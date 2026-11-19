import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

test('main surfaces meet automated WCAG AA checks on desktop and mobile', async ({ page }) => {
  const reports: { surface: string; violations: { id: string; targets: string[][] }[] }[] = [];
  await page.goto('/');
  await expect(page.locator('.welcome-copy')).toHaveCSS('opacity', '1');
  const audit = async (surface: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    reports.push({
      surface,
      violations: results.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target as string[]),
      })),
    });
    expect
      .soft(
        results.violations,
        `${surface}: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`,
      )
      .toEqual([]);
  };
  await audit('welcome');
  await page.getByRole('button', { name: 'Explore the live demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
  await expect(page.locator('.inbox-task').first()).toHaveCSS('opacity', '1');
  await audit('daily timeline');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.locator('dialog > div')).toHaveCSS('opacity', '1');
  await audit('task editor');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await audit('mobile timeline');
  await page
    .getByRole('button', { name: /^Inbox/ })
    .filter({ has: page.locator('svg') })
    .last()
    .click();
  await audit('mobile Inbox');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /^Projects/ }).click();
  await audit('projects');
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await audit('completed tasks');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('.full-task-list .inbox-task')).toHaveCount(0);
  await audit('archive');
  await page.getByRole('button', { name: 'How Flow works', exact: true }).click();
  await expect(page.locator('dialog > div')).toHaveCSS('opacity', '1');
  await audit('introduction');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('dialog > div')).toHaveCSS('opacity', '1');
  await audit('settings');
  await page.getByLabel('Day starts', { exact: true }).fill('09:00');
  await page.getByLabel('Day ends', { exact: true }).fill('10:00');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'My Day', exact: true }).click();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await page.getByRole('button', { name: 'Organize my day', exact: true }).click();
  await expect(page.locator('.unscheduled-reason').first()).toBeVisible();
  // Audit the confirmed state after exiting cards and previous notifications
  // have finished fading; animation frames are not the final text contrast.
  await expect(page.locator('.inbox-list .inbox-task')).toHaveCount(2);
  await expect(page.locator('.toast')).toHaveCount(1);
  await expect(page.locator('.toast')).toHaveCSS('opacity', '1');
  await audit('partial planning');
  await page.screenshot({ path: 'artifacts/partial-planning.png', animations: 'disabled' });
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/a11y-report.json', JSON.stringify(reports, null, 2));
});
