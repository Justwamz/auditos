import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';

test('another firm, and staff not on the engagement, cannot reach the engagement', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, 'partner@firm-a.example.test');
  await a.goto('/engagements');
  await a.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await expect(a.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();
  const url = a.url();
  const id = /engagements\/([0-9a-f-]{36})/.exec(url)![1]!;

  // Firm B manager: same URL, nothing found, and no leakage of the client name.
  const b = await (await browser.newContext()).newPage();
  await signIn(b, 'manager@firm-b.example.test');
  await b.goto(`/engagements/${id}`);
  await expect(b.getByText('could not be found')).toBeVisible();
  await expect(b.getByText('Mwangaza')).toHaveCount(0);
  const apiStatuses = await b.evaluate(async (engId) => {
    const get = async (p: string) => (await fetch(`/api${p}`, { credentials: 'same-origin' })).status;
    return [await get(`/engagements/${engId}`), await get(`/engagements/${engId}/statements`), await get(`/engagements/${engId}/items`), await get(`/engagements/${engId}/tb`)];
  }, id);
  expect(apiStatuses).toEqual([404, 404, 404, 404]);

  // Firm B sees no engagements of its own either.
  await b.goto('/engagements');
  await expect(b.getByText('No engagements yet.')).toBeVisible();

  // A firm administrator sees people, not engagements.
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'firm-admin@firm-a.example.test');
  await admin.goto('/admin/users');
  await expect(admin.getByRole('heading', { name: 'People and access' })).toBeVisible();
  await admin.goto(`/engagements/${id}`);
  await expect(admin.getByText('could not be found')).toBeVisible();
});

test('the statements page shows the draft statements with comparatives after carry-forward', async ({ page }) => {
  await signIn(page, 'partner@firm-a.example.test');
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await page.getByRole('tab', { name: 'Financial statements' }).click();
  await page.getByRole('button', { name: 'Carry forward from last year' }).click();
  await expect(page.getByText('Carried forward')).toBeVisible();
  await page.getByRole('tab', { name: 'Statements', exact: true }).click();
  await expect(page.getByText('Draft: not approved for issue')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Profit for the year' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '130,000.00' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '1,150,000.00' }).first()).toBeVisible();
});
