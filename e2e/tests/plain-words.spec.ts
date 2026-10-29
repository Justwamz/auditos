import { expect, test, type Page } from '@playwright/test';
import { BANNED, freshCode, signIn, user } from '../helpers';

// Roles that only get their menu pages checked (their screens are the same ones the four below see).
const MENU_ONLY = [
  { name: 'Faith (senior)', email: 'faith.njeri@kangethe.example.test', admin: false },
  { name: 'Mercy (quality officer)', email: 'mercy.achieng@kangethe.example.test', admin: false },
  { name: 'Samuel (EQR)', email: 'samuel.kariuki@kangethe.example.test', admin: false },
];
const PEOPLE = [
  { name: 'Grace (partner)', email: 'grace.kangethe@kangethe.example.test', admin: false },
  { name: 'Daniel (manager)', email: 'daniel.otieno@kangethe.example.test', admin: false },
  { name: 'Brian (staff)', email: 'brian.kiptoo@kangethe.example.test', admin: false },
  { name: 'Wanjiru (administrator)', email: 'wanjiru.mugo@kangethe.example.test', admin: true },
];
const HEADINGS = ['My work', 'Clients and audits', 'Business', 'Firm'];
// Pages outside the menu that people reach from it. A page a role may not open just says so, in plain words.
const EXTRA = ['/branding', '/billing/settings', '/billing/outbox', '/invoices', '/invoices/new', '/quotes', '/quotes/new', '/audit-trail', '/help'];

const settle = async (page: Page) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.locator('.today-skeleton, .skeleton')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
};

/** Opens every collapsed section one by one, calling check after each, because some sections close the others. */
async function openAll(page: Page, check: () => Promise<void>): Promise<void> {
  const all = page.locator('main button[aria-expanded]:visible:not(.row-menu-btn)');
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const b = all.nth(i);
    if ((await b.getAttribute('aria-expanded').catch(() => null)) !== 'false') continue;
    await b.click({ timeout: 2000 }).catch(() => undefined);
    await check();
  }
}

/** Every banned word found in what a person reads on this page: text, hover titles and accessible names. */
async function words(page: Page): Promise<string[]> {
  const text = await page.locator('body').innerText();
  const names = await page.locator('[title], [aria-label], [placeholder]').evaluateAll((els) =>
    els.flatMap((e) => ['title', 'aria-label', 'placeholder'].map((a) => e.getAttribute(a) ?? '')),
  );
  const all = `${text}\n${names.join('\n')}`;
  return BANNED.filter((re) => re.test(all)).map(String);
}

async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  expect(await words(page), `${label} (collapsed)`).toEqual([]);
  await openAll(page, async () => expect(await words(page), `${label} (a section opened)`).toEqual([]));
}

/** Opens each "+ ..." panel on the page in turn, reads it, and closes it again. */
async function scanPanels(page: Page, label: string): Promise<void> {
  const adders = page.locator('main button:visible', { hasText: /^\+ / });
  const n = await adders.count();
  for (let i = 0; i < n; i++) {
    await adders.nth(i).click();
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) {
      await dialog.first().waitFor();
      expect(await words(page), `${label} panel ${i + 1}`).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  }
}

test('the sign-in steps use plain words @sweep', async ({ page }) => {
  const email = PEOPLE[0]!.email;
  await page.goto('/login');
  await settle(page);
  expect(await words(page), 'sign-in, step 1').toEqual([]);
  await page.fill('#email', email);
  await page.fill('#password', user(email).password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('#code');
  expect(await words(page), 'sign-in, step 2').toEqual([]);
  await page.fill('#code', await freshCode(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/[/](clients)?$/);
});

for (const person of PEOPLE) {
  test(`${person.name}: the menu follows the plan and every screen in it uses plain words @sweep`, async ({ page }) => {
    test.setTimeout(600_000);
    await signIn(page, person.email);
    const main = page.getByRole('navigation', { name: 'Main' });

    // Menu: the plan's headings in order, at most five headings and ten links.
    await expect(main.getByRole('link').first()).toBeVisible();
    const headings = await main.getByRole('group').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).filter((h): h is string => !!h));
    expect(headings, 'menu headings').toEqual(HEADINGS.filter((h) => headings.includes(h)));
    expect(headings.length).toBeLessThanOrEqual(5);
    const links = await main.getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    expect(links.length).toBeLessThanOrEqual(10);
    if (!person.admin) expect(links[0]).toBe('/');
    expect(links.at(-1)).toBe('/help');

    for (const href of links) {
      await page.goto(href);
      await scan(page, `${person.name} ${href}`);
      await scanPanels(page, `${person.name} ${href}`);
    }

    // Prospects as a table (opened rows and row menu) and as cards; Calendar in all four views.
    if (links.includes('/pipeline')) {
      await page.goto('/pipeline');
      await settle(page);
      const menu = page.locator('.row-menu-btn:visible').first();
      if (await menu.count()) {
        await menu.click();
        expect(await words(page), `${person.name} prospect row menu`).toEqual([]);
        await page.keyboard.press('Escape');
      }
      await scan(page, `${person.name} prospects table`);
      await page.getByRole('radio', { name: 'Cards' }).click();
      await scan(page, `${person.name} prospects cards`);
    }
    if (links.includes('/calendar')) {
      await page.goto('/calendar');
      for (const view of ['Month', 'Day', 'Work week', 'Week']) {
        await page.getByRole('radio', { name: view, exact: true }).click();
        await scan(page, `${person.name} calendar ${view}`);
      }
    }

    // A client, an engagement and each of its tabs.
    if (links.includes('/clients')) {
      await page.goto('/clients');
      await settle(page);
      await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
      await expect(page.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();
      await scan(page, `${person.name} client`);
    }
    if (links.includes('/engagements')) {
      await page.goto('/engagements');
      await settle(page);
      await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
      await expect(page.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();
      const tabs = page.getByRole('tablist', { name: 'Engagement sections' }).getByRole('tab');
      const names = await tabs.allInnerTexts();
      for (const name of names) {
        await page.getByRole('tab', { name, exact: true }).click();
        await scan(page, `${person.name} engagement ${name}`);
        await scanPanels(page, `${person.name} engagement ${name}`);
      }
    }

    // Pages reached from inside the menu items.
    for (const path of EXTRA) {
      if (links.includes(path)) continue;
      await page.goto(path);
      await scan(page, `${person.name} ${path}`);
    }
  });
}

test('every help guide uses plain words', async ({ page }) => {
  test.setTimeout(600_000);
  await signIn(page, PEOPLE[0]!.email);
  await page.goto('/help');
  await settle(page);
  const hrefs = await page.locator('a[href^="/help/"]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href') ?? ''))]);
  expect(hrefs.length).toBeGreaterThan(5);
  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await scan(page, `help ${href}`);
  }
});

for (const person of MENU_ONLY) {
  test(`${person.name}: the menu follows the plan and its pages use plain words @sweep`, async ({ page }) => {
    test.setTimeout(600_000);
    await signIn(page, person.email);
    const main = page.getByRole('navigation', { name: 'Main' });
    await expect(main.getByRole('link').first()).toBeVisible();
    const links = await main.getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    expect(links.length).toBeLessThanOrEqual(10);
    expect(links[0]).toBe('/');
    expect(links.at(-1)).toBe('/help');
    for (const href of links) {
      await page.goto(href);
      await scan(page, `${person.name} ${href}`);
    }
  });
}
