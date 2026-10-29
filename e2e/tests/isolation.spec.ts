import { expect, test } from '@playwright/test';
import { BANNED, signIn } from '../helpers';

const MAIN = 'main button:visible:not(.secondary):not(.quiet):not(.danger):not(.chip):not(.disclosure-btn):not(.row-menu-btn)';

test('another firm, and staff not on the engagement, cannot reach the engagement', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, 'grace.kangethe@kangethe.example.test');
  await a.goto('/engagements');
  await a.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await expect(a.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();
  const url = a.url();
  const id = /engagements\/([0-9a-f-]{36})/.exec(url)![1]!;

  // Firm B manager: same URL, nothing found, and no leakage of the client name.
  const b = await (await browser.newContext()).newPage();
  await signIn(b, 'esther.wairimu@waweru.example.test');
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
  await signIn(admin, 'wanjiru.mugo@kangethe.example.test');
  await admin.goto('/admin/users');
  await expect(admin.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
  await admin.goto(`/engagements/${id}`);
  await expect(admin.getByText('could not be found')).toBeVisible();
});

test('the statements page shows the draft statements with comparatives after carry-forward', async ({ page }) => {
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await page.getByRole('tab', { name: 'Financial statements' }).click();
  // Another spec may already have carried the figures forward; do it only if the button is still offered.
  const carry = page.getByRole('button', { name: 'Carry forward from last year' });
  if (await carry.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
    await carry.click();
    await expect(page.getByText('Carried forward')).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Statements', exact: true }).click();
  await expect(page.getByText('Draft: not approved for issue')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Profit for the year' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '130,000.00' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '1,150,000.00' }).first()).toBeVisible();
});

test('people: invite in a side panel, pause and restore access from the row menu', async ({ page }) => {
  await signIn(page, 'wanjiru.mugo@kangethe.example.test');
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Everyone in the firm' });
  await expect(table.getByRole('row', { name: /Ruth Wambui/ })).toBeVisible();
  const before = (await table.getByRole('row').count()) - 1;
  await expect(page.locator(MAIN)).toHaveCount(1);
  await expect(page.getByLabel('Full name')).toHaveCount(0);
  const text = await page.locator('main').innerText();
  for (const re of BANNED) expect(text, `people contains ${re}`).not.toMatch(re);
  await expect(page.getByRole('button', { name: 'Switch off' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Sign-in code' })).toBeVisible();

  await page.getByRole('button', { name: '+ Invite someone' }).click();
  const panel = page.getByRole('dialog', { name: 'Invite someone' });
  await expect(panel.getByLabel('Full name')).toBeFocused();
  const email = `temp.person.${Date.now()}@kangethe.example.test`;
  await panel.getByLabel('Full name').fill('Temp Person');
  await panel.getByLabel('Personal email').fill(email);
  await panel.getByRole('button', { name: 'Create invite' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Send this one-time link to Temp Person')).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(before + 2);

  const row = table.getByRole('row', { name: /Temp Person/ });
  await expect(row).toContainText('Active');
  await row.scrollIntoViewIfNeeded();
  await row.getByRole('button', { name: 'Actions for Temp Person' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Pause access', 'Hand over']);
  await page.getByRole('menuitem', { name: 'Pause access' }).click();
  await expect(row).toContainText('Paused');
  await row.scrollIntoViewIfNeeded();
  await row.getByRole('button', { name: 'Actions for Temp Person' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Restore access']);
  await page.getByRole('menuitem', { name: 'Restore access' }).click();
  await expect(row).toContainText('Active');
});
