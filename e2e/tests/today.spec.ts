import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';

test('a partner lands on Today with a greeting by first name, rows that open, and the engagements table', async ({ page }) => {
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Grace$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your engagements' })).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(page.locator('.today-skeleton')).toHaveCount(0);
  const cards = page.locator('.today-card');
  const empty = page.getByText('Nothing needs you today.');
  await expect(cards.first().or(empty)).toBeVisible();
  const n = await cards.count();
  expect(await page.locator('.today-card a', { hasText: 'Open' }).count()).toBe(n);
  if (n > 0) await expect(cards.first().getByRole('link', { name: /^Open/ })).toHaveAttribute('href', /^\//);
});

test('the firm administrator has no Today page and ends on Clients', async ({ page }) => {
  await signIn(page, 'wanjiru.mugo@kangethe.example.test');
  await page.goto('/');
  await expect(page).toHaveURL(/[/]clients$/);
  await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
});

test('staff see their own rows and no billing row', async ({ page }) => {
  await signIn(page, 'brian.kiptoo@kangethe.example.test');
  await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Brian$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your engagements' })).toBeVisible();
  await expect(page.locator('.today-skeleton')).toHaveCount(0);
  await expect(page.locator('.today-card', { hasText: /overdue/i })).toHaveCount(0);
  await expect(page.locator('.today-card', { hasText: /needs your (review|approval)/ })).toHaveCount(0);
});
