import { expect, test, type Page } from '@playwright/test';
import { openDemoPaper, signIn } from '../helpers';

const BANNED = [/authenticator/i, /outbox/i, /simulatw*/i, /session/i, /csrf/i, /malware/i, /quarantinw*/i, /fingerprint/i, /sha-?256/i, /tenant/i, /token/i, /payload/i, /api/i, /mfa/i, /totp/i];
// A main button is a filled one: not secondary, quiet or danger, not a chip, not an accordion header.
const MAIN = 'main button:visible:not(.secondary):not(.quiet):not(.danger):not(.chip):not(.disclosure-btn):not(.row-menu-btn)';
const plain = async (page: Page, label: string) => {
  const text = await page.locator('main').innerText();
  for (const re of BANNED) expect(text, `${label} contains ${re}`).not.toMatch(re);
};

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
  await staff.getByRole('button', { name: 'Show details (this is recorded)' }).click();
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

  // The old button name is gone; search and the type of activity narrow the list.
  const table = partner.getByRole('table', { name: 'Activity history' });
  await expect(table.getByRole('row').nth(1)).toBeVisible();
  const all = (await table.getByRole('row').count()) - 1;
  const type = partner.getByRole('group', { name: 'Type of activity' });
  await expect(type.getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'true');
  await type.getByRole('button', { name: 'Personal details revealed' }).click();
  await expect(type.getByRole('button', { name: 'Personal details revealed' })).toHaveAttribute('aria-pressed', 'true');
  await expect(table.getByRole('row', { name: /revealed the phone number of Jane Wambui/ })).toHaveCount(1);
  const revealed = (await table.getByRole('row').count()) - 1;
  expect(revealed).toBeLessThanOrEqual(all);
  await type.getByRole('button', { name: 'Everything' }).click();
  await expect(table.getByRole('row')).toHaveCount(all + 1);
  await partner.getByRole('searchbox', { name: 'Search activity' }).fill('Calling to confirm');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row', { name: /Jane Wambui/ })).toHaveCount(1);
  await partner.getByRole('searchbox', { name: 'Search activity' }).fill('zzzz nothing like this');
  await expect(partner.getByText('No activity matches')).toBeVisible();
  await expect(table).toHaveCount(0);
  await partner.getByRole('button', { name: 'Show everything' }).click();
  await expect(table.getByRole('row')).toHaveCount(all + 1);
  await plain(partner, 'activity history');
  await expect(partner.locator(MAIN)).toHaveCount(0);
});

test('independence: declarations sit in a table and a new one is made in a side panel', async ({ page }) => {
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Quality and independence' }).click();
  await expect(page.getByRole('heading', { name: 'Independence', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Quality sections' }).getByRole('link', { name: 'Independence' })).toHaveAttribute('aria-current', 'page');
  const table = page.getByRole('table', { name: 'Your declarations' });
  await expect(table).toBeVisible();
  await page.waitForLoadState('networkidle');
  const before = (await table.getByRole('row').count()) - 1;
  // One main button, and the form is not on the page until it is asked for.
  await expect(page.locator(MAIN)).toHaveCount(1);
  await expect(page.getByRole('button', { name: '+ Make a declaration' })).toBeVisible();
  await expect(page.getByLabel('Declaration', { exact: true })).toHaveCount(0);
  await plain(page, 'independence');

  await page.getByRole('button', { name: '+ Make a declaration' }).click();
  const panel = page.getByRole('dialog', { name: 'Make a declaration' });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Declaration', { exact: true })).toBeFocused();
  await plain(page, 'independence panel');
  await panel.getByLabel('Threat identified').fill('A family member holds shares in a client');
  await panel.getByLabel('Safeguard applied').fill('I will not work on that client');
  await panel.getByRole('button', { name: 'Submit declaration' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Declaration recorded.')).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(before + 2);
  await expect(page.getByRole('button', { name: '+ Make a declaration' })).toBeFocused();
});

test('a paper keeps every version and shows what changed', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await openDemoPaper(page, 'Client acceptance and continuance');
  await page.getByRole('button', { name: 'Show history' }).click();
  await expect(page.getByText('Every version is kept for good')).toBeVisible();
  await expect(page.getByRole('button', { name: 'What changed' }).first()).toBeVisible();
});
