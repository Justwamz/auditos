import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../helpers';

const names = async (page: Page) => {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Pipeline', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  return (await page.locator('.card strong').allTextContents()).sort();
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
  await expect(daniel.getByText('Pwani Fisheries Ltd')).toBeVisible();
  await expect(daniel.getByText('By person:')).toBeVisible();
  await expect(brian.getByText('By person:')).toHaveCount(0);

  // The firm administrator has no pipeline.
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'wanjiru.mugo@kangethe.example.test');
  await expect(admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pipeline' })).toHaveCount(0);
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
