import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../helpers';

const names = async (page: Page) => {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Prospects', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.prospect-name').first()).toBeVisible();
  return (await page.locator('.prospect-name').allTextContents()).sort();
};

test('the pipeline shows each person their own prospects, and managers and partners all of them', async ({ browser }) => {
  const brian = await (await browser.newContext()).newPage();
  await signIn(brian, 'brian.kiptoo@kangethe.example.test');
  expect(await names(brian)).toEqual(['Baraka Hauliers Ltd']);

  const tom = await (await browser.newContext()).newPage();
  await signIn(tom, 'tom.odhiambo@kangethe.example.test');
  expect(await names(tom)).toEqual(['Kito Logistics Ltd']);

  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  expect(await names(daniel)).toEqual(['Baraka Hauliers Ltd', 'Kito Logistics Ltd', 'Mlima Coffee Cooperative', 'Tembo Apartments Ltd', 'Zawadi Medical Centre']);
  await expect(daniel.getByRole('button', { name: /^Lead\s*3$/ })).toBeVisible();
  await expect(daniel.getByLabel('Show prospects of')).toBeVisible();
  await expect(daniel.getByText('By person:')).toHaveCount(0);
  await expect(brian.getByLabel('Show prospects of')).toHaveCount(0);
  // Closed prospects sit in a folded section below the table.
  await daniel.getByRole('button', { name: /Closed/ }).click();
  await expect(daniel.getByText('Pwani Fisheries Ltd')).toBeVisible();

  // The firm administrator has no pipeline.
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'wanjiru.mugo@kangethe.example.test');
  await expect(admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pipeline' })).toHaveCount(0);
});

test('the prospects page: add panel, table and cards, search and the row menu', async ({ browser }) => {
  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await daniel.goto('/pipeline');
  await expect(daniel.getByRole('heading', { name: 'Prospects', level: 1 })).toBeVisible();
  await expect(daniel.locator('.prospect-name').first()).toBeVisible();

  // The add panel is a dialog; Escape closes it and focus goes back to the button.
  const add = daniel.getByRole('button', { name: '+ Add a prospect' });
  await add.click();
  await expect(daniel.getByRole('dialog')).toBeVisible();
  await daniel.keyboard.press('Escape');
  await expect(daniel.getByRole('dialog')).toHaveCount(0);
  await expect(add).toBeFocused();

  // Cards view shows the stage sections and is remembered after a reload.
  await daniel.getByRole('radio', { name: 'Cards' }).click();
  const section = daniel.locator('.disclosure-btn', { hasText: 'Engagement letter sent' });
  await expect(section).toBeVisible();
  await daniel.reload();
  await expect(daniel.getByRole('radio', { name: 'Cards' })).toBeChecked();
  await expect(section).toBeVisible();
  await daniel.getByRole('radio', { name: 'Table' }).click();

  // Search with no match.
  await daniel.getByLabel('Search prospects').fill('zzzz nothing');
  await expect(daniel.getByText('No prospects match')).toBeVisible();
  await daniel.getByLabel('Search prospects').fill('');

  // The row menu: a manager may hand over and make a client.
  const menu = daniel.getByRole('button', { name: 'Actions for Baraka Hauliers Ltd' });
  await menu.click();
  await expect(daniel.getByRole('menuitem', { name: 'Move to Proposal sent' })).toBeVisible();
  await expect(daniel.getByRole('menuitem', { name: 'Mark as lost' })).toBeVisible();
  await expect(daniel.getByRole('menuitem', { name: 'Make a client' })).toBeVisible();
  await daniel.getByRole('menuitem', { name: 'Hand over' }).click();
  await expect(daniel.getByRole('dialog')).toBeVisible();
  await daniel.keyboard.press('Escape');
  await expect(daniel.getByRole('dialog')).toHaveCount(0);
  await expect(menu).toBeFocused();

  // Staff can move and mark as lost, but not hand over or make a client.
  const brian = await (await browser.newContext()).newPage();
  await signIn(brian, 'brian.kiptoo@kangethe.example.test');
  await brian.goto('/pipeline');
  await expect(brian.locator('.prospect-name').first()).toBeVisible();
  await brian.getByRole('button', { name: 'Actions for Baraka Hauliers Ltd' }).click();
  await expect(brian.getByRole('menuitem', { name: 'Move to Proposal sent' })).toBeVisible();
  await expect(brian.getByRole('menuitem', { name: 'Mark as lost' })).toBeVisible();
  await expect(brian.getByRole('menuitem', { name: 'Hand over' })).toHaveCount(0);
  await expect(brian.getByRole('menuitem', { name: 'Make a client' })).toHaveCount(0);
});

test('the calendar shows each person the events that concern them', async ({ browser }) => {
  const calendarOf = async (email: string) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, email);
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    return page;
  };

  const brian = await calendarOf('brian.kiptoo@kangethe.example.test');
  await expect(brian.getByText('Fieldwork: Mwangaza stock count').first()).toBeVisible();
  await expect(brian.getByText('Pre-planning meeting: Savannah Farms')).toHaveCount(0);

  const tom = await calendarOf('tom.odhiambo@kangethe.example.test');
  await expect(tom.getByText('Annual leave').first()).toBeVisible();
  await expect(tom.getByText('Fieldwork: Mwangaza stock count')).toHaveCount(0);

  const grace = await calendarOf('grace.kangethe@kangethe.example.test');
  await expect(grace.getByText('Pre-planning meeting: Savannah Farms').first()).toBeVisible();
  await expect(grace.getByText('Fieldwork: Mwangaza stock count').first()).toBeVisible();
  await grace.getByRole('button', { name: 'Next week' }).click();
  await expect(grace.getByText('Management meeting').first()).toBeVisible();
});

test('a partner can change a client\'s account manager; a manager cannot', async ({ browser }) => {
  const grace = await (await browser.newContext()).newPage();
  await signIn(grace, 'grace.kangethe@kangethe.example.test');
  await grace.goto('/clients');
  await grace.waitForLoadState('networkidle');
  await grace.getByRole('link', { name: 'Savannah Farms Ltd' }).click();
  // The client page compiles on first visit in the dev server, which can take a while on a busy machine.
  await expect(grace.getByRole('heading', { name: 'Savannah Farms Ltd', level: 1 })).toBeVisible({ timeout: 90_000 });
  await expect(grace.getByRole('heading', { name: 'Change the account manager' })).toBeVisible({ timeout: 30_000 });

  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await daniel.goto('/clients');
  await daniel.getByRole('link', { name: 'Mwangaza Traders Ltd' }).click();
  await expect(daniel.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();
  await expect(daniel.getByRole('heading', { name: 'Change the account manager' })).toHaveCount(0);
});

test('a person who still holds clients cannot be switched off, and the hand-over shows what they hold', async ({ page }) => {
  await signIn(page, 'wanjiru.mugo@kangethe.example.test');
  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: /Ruth Wambui/ });
  await row.getByRole('button', { name: 'Switch off' }).click();
  await expect(page.getByText('still manages clients or owns open prospects')).toBeVisible();
  await row.getByRole('button', { name: 'Hand over' }).click();
  await expect(page.getByText('Savannah Farms Ltd, Umoja Staff Pension Scheme')).toBeVisible();
});
