import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';

test('the engagement opens on a roadmap with one next step, and materiality can be calculated', async ({ page }) => {
  await signIn(page, 'manager@kangethe.example.test');
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();

  await expect(page.getByRole('heading', { name: 'Audit roadmap' })).toBeVisible();
  await expect(page.getByText('Your next step')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Audit progress' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Pre-planning meeting' })).toBeVisible();

  await page.getByRole('tab', { name: 'Working papers' }).click();
  await page.getByLabel('Benchmark amount (KES)').fill('120000000');
  await page.getByLabel('Why this benchmark and percentage').fill('Revenue is the stable benchmark for a trading entity.');
  await page.getByRole('button', { name: 'Calculate and save' }).click();
  await expect(page.getByText('KES 1,200,000.00')).toBeVisible();
  await expect(page.getByText('KES 900,000.00')).toBeVisible();
});
