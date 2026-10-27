import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';

test('help shows guides written for the signed-in role, and never the ones for other roles', async ({ browser }) => {
  // Staff: finds the guide on personal details and nothing about approving or locking.
  const staff = await (await browser.newContext()).newPage();
  await signIn(staff, 'brian.kiptoo@kangethe.example.test');
  await staff.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Help', exact: true }).click();
  await expect(staff.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
  await staff.getByLabel('Search the help').fill('reveal a phone number');
  await staff.getByRole('button', { name: 'Search' }).click();
  await expect(staff.getByRole('link', { name: 'Personal details are masked' })).toBeVisible();

  await staff.getByLabel('Search the help').fill('approve and lock the engagement');
  await staff.getByRole('button', { name: 'Search' }).click();
  await expect(staff.getByRole('link', { name: 'Approving, issuing the report and locking' })).toHaveCount(0);

  // A partner-only guide is not even reachable by address.
  await staff.goto('/help/approve-issue-lock');
  await expect(staff.getByText('could not be found, or it is not written for your role')).toBeVisible();

  // The partner has it.
  const partner = await (await browser.newContext()).newPage();
  await signIn(partner, 'grace.kangethe@kangethe.example.test');
  await partner.goto('/help/approve-issue-lock');
  await expect(partner.getByRole('heading', { name: 'Approving, issuing the report and locking', level: 1 })).toBeVisible();
  await expect(partner.getByRole('heading', { name: 'Lock the engagement' })).toBeVisible();
});

test('"help on this page" opens the guides for that page', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await page.getByRole('tab', { name: 'Checklists' }).click();
  await page.getByRole('link', { name: 'How checklists work' }).click();
  await expect(page.getByRole('heading', { name: 'For the page you were on' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Answering checklists' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Answering checklists' }).first().click();
  await expect(page.getByRole('heading', { name: 'Answering checklists', level: 1 })).toBeVisible();
});
