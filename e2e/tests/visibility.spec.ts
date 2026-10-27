import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../helpers';

const ALL = ['Lakeview Rentals Ltd', 'Mwangaza Traders Ltd', 'Savannah Farms Ltd', 'Umoja Staff Pension Scheme'];

/** Who sees which client in the demo firm, and the reason shown for each. */
const PROFILES: { who: string; email: string; clients: string[] }[] = [
  { who: 'Grace Kangethe (partner)', email: 'grace.kangethe@kangethe.example.test', clients: ALL },
  { who: 'Charles Kamau (partner)', email: 'charles.kamau@kangethe.example.test', clients: ALL },
  { who: 'Daniel Otieno (manager)', email: 'daniel.otieno@kangethe.example.test', clients: ['Lakeview Rentals Ltd', 'Mwangaza Traders Ltd'] },
  { who: 'Ruth Wambui (manager)', email: 'ruth.wambui@kangethe.example.test', clients: ['Savannah Farms Ltd', 'Umoja Staff Pension Scheme'] },
  { who: 'Faith Njeri (senior)', email: 'faith.njeri@kangethe.example.test', clients: ['Mwangaza Traders Ltd', 'Savannah Farms Ltd'] },
  { who: 'Brian Kiptoo (staff)', email: 'brian.kiptoo@kangethe.example.test', clients: ['Lakeview Rentals Ltd', 'Mwangaza Traders Ltd'] },
  { who: 'Tom Odhiambo (staff, no assignments)', email: 'tom.odhiambo@kangethe.example.test', clients: [] },
  { who: 'Wanjiru Mugo (firm administrator)', email: 'wanjiru.mugo@kangethe.example.test', clients: ALL },
];

const clientNames = async (page: Page) => {
  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  return (await page.locator('table tbody tr td:first-child a').allTextContents()).sort();
};

for (const p of PROFILES) {
  test(`${p.who} sees exactly the right clients`, async ({ page }) => {
    await signIn(page, p.email);
    await expect(page.getByRole('heading', { name: 'What you can see' })).toBeVisible();
    expect(await clientNames(page)).toEqual(p.clients);
    if (p.clients.length === 0) {
      await page.goto('/');
      await expect(page.getByText('You are not on any engagement team yet, so you see no clients.')).toBeVisible();
    }
  });
}

test('a partner reads an engagement they are not on, but is told it is view only', async ({ page }) => {
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await page.goto('/engagements');
  await expect(page.getByText('view only').first()).toBeVisible();
  await page.getByRole('link', { name: 'Savannah Farms Ltd' }).click();
  await expect(page.getByText('You are viewing this engagement as a partner. You are not on its team')).toBeVisible();
});
