import { expect, test } from '@playwright/test';
import { openDemoPaper, signIn } from '../helpers';

test('personal details are masked, revealing needs a reason, and the reveal shows in the activity history', async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();
  await signIn(staff, 'brian.kiptoo@kangethe.example.test');
  await staff.goto('/clients');
  await staff.getByRole('link', { name: 'Mwangaza Traders Ltd' }).click();
  await expect(staff.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();

  // Masked by default, and the real value is nowhere on the page.
  await expect(staff.getByText('+••• ••• ••• 678')).toBeVisible();
  await expect(staff.getByText('345')).toHaveCount(0);

  // A reason is required; once given, the value shows and then the log records it.
  await staff.getByRole('button', { name: 'Reveal' }).first().click();
  await staff.getByLabel('Reason for revealing the phone of Jane Wambui').fill('Calling to confirm the year-end visit');
  await staff.getByRole('button', { name: 'Reveal and record' }).click();
  await expect(staff.getByText('+254 712 345 678')).toBeVisible();

  // Staff have no activity history.
  await expect(staff.getByRole('link', { name: 'Activity history' })).toHaveCount(0);

  // The partner reads it, in plain English, with the reason.
  const partner = await (await browser.newContext()).newPage();
  await signIn(partner, 'grace.kangethe@kangethe.example.test');
  await partner.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Quality and independence' }).click();
  await partner.getByRole('navigation', { name: 'Quality sections' }).getByRole('link', { name: 'Activity history' }).click();
  await expect(partner.getByRole('heading', { name: 'Activity history', level: 1 })).toBeVisible();
  await expect(partner.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Quality and independence' })).toHaveAttribute('aria-current', 'page');
  await expect(
    partner.getByText('Brian Kiptoo revealed the phone number of Jane Wambui at Mwangaza Traders Ltd. Reason given: "Calling to confirm the year-end visit"'),
  ).toBeVisible();
});

test('a paper keeps every version and shows what changed', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await openDemoPaper(page, 'Client acceptance and continuance');
  await page.getByRole('button', { name: 'Show history' }).click();
  await expect(page.getByText('Every version is kept for good')).toBeVisible();
  await expect(page.getByRole('button', { name: 'What changed' }).first()).toBeVisible();
});
