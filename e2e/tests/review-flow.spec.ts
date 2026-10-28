import { expect, test } from '@playwright/test';
import { confirmStepUp, openDemoPaper, signIn } from '../helpers';

const STAFF = 'brian.kiptoo@kangethe.example.test';
const MANAGER = 'daniel.otieno@kangethe.example.test';
const PARTNER = 'grace.kangethe@kangethe.example.test';
const TITLE = 'Understanding the business';

const stamp = (page: import('@playwright/test').Page, label: string) =>
  page.getByRole('group', { name: 'Sign-offs' }).locator('.stamp', { hasText: label });

test('a paper goes through preparation, review, revocation on edit, approval and two-person deletion', async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();
  const manager = await (await browser.newContext()).newPage();
  const partner = await (await browser.newContext()).newPage();

  // Staff prepares.
  await signIn(staff, STAFF);
  await openDemoPaper(staff, TITLE);
  await staff.getByRole('button', { name: 'Sign as prepared' }).click();
  await confirmStepUp(staff, STAFF);
  await expect(staff.getByText('Signed.')).toBeVisible();
  await expect(stamp(staff, 'Prepared')).toContainText('BK');
  // Sign-off boxes keep the 13px reading floor and their text stays inside the box.
  for (const label of ['Prepared', 'Reviewed', 'Approved']) {
    const box = stamp(staff, label);
    expect(await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
    expect(await box.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }

  // Manager reviews.
  await signIn(manager, MANAGER);
  await openDemoPaper(manager, TITLE);
  await manager.getByRole('button', { name: 'Sign as reviewed' }).click();
  await confirmStepUp(manager, MANAGER);
  await expect(stamp(manager, 'Reviewed')).toContainText('DO');
  await expect(manager.locator('.state', { hasText: 'Manager reviewed' }).first()).toBeVisible();

  // Staff edits the reviewed paper: the review is revoked and stays visible, struck through.
  await staff.reload();
  await staff.getByRole('tab', { name: 'Working papers' }).click();
  await staff.getByRole('row', { name: new RegExp(TITLE) }).getByRole('button', { name: /^Open$/ }).click();
  await expect(staff.getByText('Saving changes will remove the review')).toBeVisible();
  await staff.getByLabel('Notes and conclusions').fill('Wholesale trader with two outlets. Added: a third outlet opened in October.');
  await staff.getByRole('button', { name: 'Save changes' }).click();
  await expect(staff.getByText('Saved as a new version.')).toBeVisible();
  await expect(stamp(staff, 'Reviewed')).toHaveClass(/revoked/);
  await expect(stamp(staff, 'Reviewed')).toContainText('(revoked)');
  await expect(staff.locator('.state', { hasText: 'Prepared' }).first()).toBeVisible();

  // Manager reviews again, partner approves.
  await manager.reload();
  await manager.getByRole('tab', { name: 'Working papers' }).click();
  await manager.getByRole('row', { name: new RegExp(TITLE) }).getByRole('button', { name: /^Open$/ }).click();
  await manager.getByRole('button', { name: 'Sign as reviewed' }).click();
  await confirmStepUp(manager, MANAGER);
  await expect(manager.getByText('Signed.')).toBeVisible();

  await signIn(partner, PARTNER);
  await openDemoPaper(partner, TITLE);
  await partner.getByRole('button', { name: 'Approve', exact: true }).click();
  await confirmStepUp(partner, PARTNER);
  await expect(stamp(partner, 'Approved')).toContainText('GK');
  await expect(partner.locator('.state', { hasText: 'Partner approved' }).first()).toBeVisible();

  // Deleting an approved paper needs a second person.
  await staff.reload();
  await staff.getByRole('tab', { name: 'Working papers' }).click();
  await staff.getByRole('row', { name: new RegExp(TITLE) }).getByRole('button', { name: /^Open$/ }).click();
  await staff.getByRole('button', { name: 'Delete…' }).click();
  await staff.getByLabel(/Why is this paper being deleted/).fill('Duplicate of the planning memo');
  await staff.getByRole('button', { name: 'Confirm deletion' }).click();
  await expect(staff.getByText('Deletion requested.')).toBeVisible();

  await manager.reload();
  await manager.getByRole('tab', { name: 'Working papers' }).click();
  await manager.getByRole('row', { name: new RegExp(TITLE) }).getByRole('button', { name: /^Open$/ }).click();
  await expect(manager.getByText('Deletion requested: “Duplicate of the planning memo”')).toBeVisible();
  await manager.getByRole('button', { name: 'Approve deletion' }).click();
  await confirmStepUp(manager, MANAGER);
  await expect(manager.getByText('Deleted.')).toBeVisible();

  await manager.reload();
  await manager.getByRole('tab', { name: 'Working papers' }).click();
  await expect(manager.getByRole('row', { name: new RegExp(TITLE) })).toHaveCount(0);
});
