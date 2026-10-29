import { expect, test } from '@playwright/test';
import { BANNED, signIn } from '../helpers';

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

test('help groups the guides in sections that open one at a time', async ({ page }) => {
  await signIn(page, 'brian.kiptoo@kangethe.example.test');
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
  const sections = page.locator('.disclosure-btn');
  await expect(sections.nth(2)).toBeVisible();
  const n = await sections.count();
  expect(n).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < n; i++) await expect(sections.nth(i)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'For the page you were on' })).toHaveCount(0);
  const first = sections.first();
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  const region = page.locator('.disclosure.is-open .disclosure-panel');
  await expect(region).toHaveCount(1);
  await expect(region.getByRole('link').first()).toBeVisible();
  // Another section closes the first.
  await sections.nth(1).click();
  await expect(sections.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.disclosure.is-open')).toHaveCount(1);
  // Search sits above the sections, and a result opens the guide.
  await page.getByLabel('Search the help').fill('reveal a phone number');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /Results/ }).getByRole('link', { name: 'Personal details are masked' })).toBeVisible();
  // The page's own words must be plain; the guides themselves are swept with the help content.
  const text = await page.locator('.page-head, [role="search"], #help-all, #help-results').allInnerTexts().then((t) => t.join(' '));
  for (const re of BANNED) expect(text, `help contains ${re}`).not.toMatch(re);
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
