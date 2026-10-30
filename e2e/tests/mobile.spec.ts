import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, PHONE, PHONE_LARGE, TABLET, expectNoHorizontalOverflow, openMenu, shot, signIn, smallInputText, smallTapTargets, user } from '../helpers';

const grace = 'grace.kangethe@kangethe.example.test';

const menuButton = (page: Page) => page.getByRole('button', { name: 'Menu', exact: true });
const mainLinks = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, grace);
});

test('phone: Menu opens a drawer with the same links, and Clients fits', async ({ page }) => {
  await page.goto('/');
  const desktopHrefs = await mainLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(desktopHrefs.length).toBeGreaterThan(0);

  await page.setViewportSize(PHONE);
  await page.goto('/clients');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(menuButton(page)).toBeVisible();
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
  for (const link of await mainLinks(page).all()) await expect(link).toBeHidden();
  await expectNoHorizontalOverflow(page, 'clients');
  expect(await smallTapTargets(page)).toEqual([]);
  expect(await smallInputText(page)).toEqual([]);
  await shot(page, 'phone-clients');

  const dialog = await openMenu(page);
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  const hrefs = await dialog.getByRole('navigation', { name: 'Main' }).getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs).toEqual(desktopHrefs);
  expect(hrefs.length).toBeLessThanOrEqual(10);
  await shot(page, 'phone-menu-open');
});

test('phone: Escape and tapping outside close the menu and focus returns to Menu', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  const dialog = await openMenu(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Menu');

  await openMenu(page);
  await page.mouse.click(PHONE.width - 10, 400);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);

  await openMenu(page);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  }
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
});

test('phone: choosing a link goes there and closes the menu', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  const dialog = await openMenu(page);
  await dialog.getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
});

test('tablet uses the drawer; desktop keeps the side menu', async ({ page }) => {
  await page.setViewportSize(TABLET);
  await page.goto('/');
  await expect(menuButton(page)).toBeVisible();
  await expectNoHorizontalOverflow(page, 'today at tablet');
  await page.setViewportSize(DESKTOP);
  await expect(menuButton(page)).toBeHidden();
  for (const link of await mainLinks(page).all()) await expect(link).toBeVisible();
});

test('widening the window with the menu open gives the normal side menu', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await openMenu(page);
  await page.setViewportSize(DESKTOP);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  for (const link of await mainLinks(page).all()) await expect(link).toBeVisible();
});

test('reduced motion: the drawer does not slide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await openMenu(page);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('main-menu')!).transitionDuration)).toBe('0s');
});

test('the page behind the open menu cannot be reached', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/clients');
  await openMenu(page);
  expect(await page.evaluate(() => document.getElementById('content')!.hasAttribute('inert'))).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.getElementById('content')!.hasAttribute('inert'))).toBe(false);
});

test('phone: Clients and Prospects show stacked rows', async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const path of ['/clients', '/pipeline']) {
    await page.goto(path);
    const table = page.locator('main table.stack-table').first();
    await expect(table).toBeVisible();
    await expect(table.locator('thead')).toBeHidden();
    const heading = (await table.locator('thead th').first().textContent())!.trim();
    await expect(table.locator('tbody tr').first().locator('td').first()).toContainText(heading);
    await expectNoHorizontalOverflow(page, path);
    await shot(page, `phone-stacked${path.replace('/', '-')}`);
  }
  await page.setViewportSize(TABLET);
  await page.goto('/pipeline');
  await expect(page.locator('main table.stack-table thead').first()).toBeVisible();
});

test('phone: a side panel fills the screen with its buttons in reach', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/clients');
  await page.locator('main button', { hasText: /^\+ / }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  const box = (await dialog.boundingBox())!;
  expect(Math.round(box.width)).toBe(PHONE.width);
  expect(Math.round(box.height)).toBe(PHONE.height);
  const foot = (await dialog.locator('.side-panel-foot').boundingBox())!;
  expect(foot.y + foot.height).toBeLessThanOrEqual(PHONE.height + 0.5);
  await shot(page, 'phone-side-panel');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize(TABLET);
  await page.locator('main button', { hasText: /^\+ / }).first().click();
  await page.waitForTimeout(400);
  expect(Math.round((await page.getByRole('dialog').boundingBox())!.width)).toBe(440);
});

test('phone: tabs scroll sideways and the chosen tab is in view', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  const tabs = page.getByRole('tablist', { name: 'Engagement sections' }).getByRole('tab');
  await tabs.last().click();
  await page.waitForTimeout(500);
  const box = (await tabs.last().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 0.5);
  await expectNoHorizontalOverflow(page, 'engagement tabs');
  await shot(page, 'phone-engagement-tabs');
});

test('phone: a row menu stays on screen', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/pipeline');
  await page.locator('.row-menu-btn').first().click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  for (const item of await menu.getByRole('menuitem').all()) expect(Math.round((await item.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
  await shot(page, 'phone-row-menu');
});

// ---- Every page at 375, 390 and 768 ------------------------------------------------------------

const wanjiru = 'wanjiru.mugo@kangethe.example.test';
const LONG_CLIENT = 'Wmnbvcxzlkjhgfdsapoiuytrewqmnbvcxzlkjhgfdsapoiuytrewqmnbvcxz'; // 60 letters, no spaces
const LONG_PROSPECT = `Prospect${'X'.repeat(52)}`;
const LONG_NOTE = 'N'.repeat(200);

let problems: string[] = [];

/** Settles like plain-words.spec.ts, then checks width, tap targets and input text, and takes a screenshot. Problems are collected, not thrown, so one run lists every page that fails. */
async function sweep(page: Page, label: string): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.locator('.today-skeleton, .skeleton')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
  const width = page.viewportSize()!.width;
  const before = problems.length;
  try {
    await expectNoHorizontalOverflow(page, `${label} @${width}`);
  } catch (e) {
    problems.push((e as Error).message.split('\n')[0]!);
  }
  const small = await smallTapTargets(page);
  if (small.length) problems.push(`${label} @${width}: small tap targets: ${small.slice(0, 6).join('; ')}`);
  const tiny = await smallInputText(page);
  if (tiny.length) problems.push(`${label} @${width}: small input text: ${tiny.slice(0, 6).join('; ')}`);
  await shot(page, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${width}`);
  if (problems.length > before) console.log(problems.slice(before).map((p) => `PROBLEM ${p}`).join('\n'));
}

const csrfOf = async (page: Page): Promise<string> => ((await (await page.request.get('/api/auth/csrf')).json()) as { token: string }).token;
async function create(page: Page, url: string, data: object): Promise<string> {
  const res = await page.request.post(url, { headers: { 'x-csrf-token': await csrfOf(page) }, data });
  expect(res.ok(), `post ${url}: ${res.status()}`).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

for (const size of [PHONE, PHONE_LARGE, TABLET]) {
  test(`every page fits at ${size.width}px`, async ({ page, browser }) => {
    test.setTimeout(900_000);
    problems = [];
    page.setDefaultTimeout(30_000);
    await page.context().clearCookies();
    await page.setViewportSize(size);

    // Signed out: both steps of sign-in.
    await page.goto('about:blank');
    await page.context().clearCookies();
    await page.goto('/login').catch(() => page.goto('/login'));
    await sweep(page, 'login first step');
    await page.fill('#email', grace);
    await page.fill('#password', user(grace).password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForSelector('#code');
    await sweep(page, 'login second step');
    await signIn(page, grace);

    for (const path of ['/', '/timesheet', '/clients']) {
      await page.goto(path);
      await sweep(page, `page ${path}`);
    }

    // Calendar: all four views, and the day panel opened from Month.
    await page.goto('/calendar');
    for (const view of ['Month', 'Day', 'Work week', 'Week']) {
      await page.getByRole('radio', { name: view, exact: true }).click();
      await sweep(page, `calendar ${view}`);
    }
    await page.getByRole('radio', { name: 'Month', exact: true }).click();
    await page.locator('.cal-cell:not(.is-other)').nth(14).click();
    await sweep(page, 'calendar Month with the day open');

    // A client, an engagement and each tab, with an item panel from a working paper.
    await page.goto('/clients');
    await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
    await expect(page.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();
    await sweep(page, 'client page');

    await page.goto('/engagements');
    await sweep(page, 'page /engagements');
    await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
    await expect(page.getByRole('heading', { name: 'Mwangaza Traders Ltd', level: 1 })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Engagement sections' }).getByRole('tab');
    for (const name of await tabs.allInnerTexts()) {
      await page.getByRole('tab', { name, exact: true }).click();
      await sweep(page, `engagement ${name}`);
    }
    await page.getByRole('tab', { name: 'Working papers' }).click();
    await page.getByRole('row').filter({ has: page.getByRole('button', { name: /^Open$/ }) }).first().getByRole('button', { name: /^Open$/ }).click();
    await sweep(page, 'working paper item');

    // Prospects as a table and as cards.
    await page.goto('/pipeline');
    await sweep(page, 'prospects table');
    await page.getByRole('radio', { name: 'Cards' }).click();
    await sweep(page, 'prospects cards');

    for (const path of ['/billing', '/invoices', '/invoices/new', '/quotes', '/quotes/new', '/billing/settings', '/billing/outbox', '/independence', '/help']) {
      await page.goto(path);
      await sweep(page, `page ${path}`);
    }
    await page.goto('/help');
    await page.locator('main button[aria-expanded="false"]').first().click();
    await page.locator('a[href^="/help/"]:visible').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await sweep(page, 'help article');

    // First invoice and first quotation; a draft is made through the API when the list is empty (the test database is reset every run).
    const clients = (await (await page.request.get('/api/clients')).json()) as { clients: { id: string; name: string }[] };
    const mwangaza = clients.clients.find((c) => c.name === 'Mwangaza Traders Ltd')!;
    const line = { description: 'Audit fieldwork, interim visit and review of the year-end working papers', quantity: '1', unitPrice: '125000.00' };
    for (const kind of ['invoices', 'quotes'] as const) {
      const list = (await (await page.request.get(`/api/${kind}`)).json()) as Record<string, { id: string }[]>;
      const id = list[kind]?.[0]?.id ?? await create(page, `/api/${kind}`, { clientId: mwangaza.id, ...(kind === 'quotes' ? { title: 'Annual audit' } : {}), taxMode: 'exclusive', taxIds: [], lines: [line] });
      await page.goto(`/${kind}/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await sweep(page, `first ${kind === 'invoices' ? 'invoice' : 'quotation'}`);
    }

    // Long text: a 60-letter client name and a prospect with a 200-character note.
    const longClient = await create(page, '/api/clients', { name: LONG_CLIENT, sector: 'trading', legalForm: 'Limited company', framework: 'IFRS_SME', yearEndMonth: 12 });
    await create(page, '/api/prospects', { name: LONG_PROSPECT, sector: 'trading', notes: LONG_NOTE, contactName: 'C'.repeat(60) });
    await page.goto('/clients');
    await sweep(page, 'long client in the list');
    await page.goto(`/clients/${longClient}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(LONG_CLIENT);
    await sweep(page, 'long client page');
    await page.goto('/pipeline');
    await page.locator('.prospect-name', { hasText: LONG_PROSPECT }).first().click();
    await sweep(page, 'long prospect opened');

    // Wanjiru: administrator pages.
    const admin = await (await browser.newContext()).newPage();
    await admin.setViewportSize(size);
    await signIn(admin, wanjiru);
    for (const path of ['/admin/users', '/branding', '/audit-trail']) {
      await admin.goto(path);
      await sweep(admin, `administrator ${path}`);
    }
    await admin.context().close();

    expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
  });
}

test('phone: stacked tables keep their table roles and every cell says what it is', async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const path of ['/clients', '/pipeline']) {
    await page.goto(path);
    const table = page.locator('main table.stack-table').first();
    await expect(table).toBeVisible();
    await expect(table).toHaveAttribute('role', 'table');
    expect(await table.locator('thead tr').first().getAttribute('role')).toBe('row');
    expect(await table.locator('tbody tr').first().getAttribute('role')).toBe('row');
    expect(await table.locator('thead th').first().getAttribute('role')).toBe('columnheader');
    expect(await table.locator('tbody tr').first().locator('td').first().getAttribute('role')).toBe('cell');
    const heads = (await table.locator('thead th').allTextContents()).map((t) => t.trim()).filter((t) => t && t !== 'Actions');
    const cells = table.locator('tbody tr').first().locator('td');
    // The label is real text in the cell (not only a CSS ::before), so screen readers read it.
    for (let i = 0; i < heads.length; i++) await expect(cells.nth(i)).toContainText(heads[i]!);
    await expect(table.getByRole('cell', { name: new RegExp(`^${heads[1]}`) }).first()).toBeVisible();
  }
  // On a wide screen the same labels are not shown or read twice: the column headings do that job.
  await page.setViewportSize(DESKTOP);
  await page.goto('/clients');
  await expect(page.locator('main table.stack-table .stack-label').first()).toBeHidden();
});

test('phone: Clients and Prospects tables scroll by keyboard when they are wider than the screen', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  for (const path of ['/clients', '/pipeline']) {
    await page.goto(path);
    const region = page.locator(`main [role=region].table-scroll`).filter({ has: page.locator('table.stack-table') }).first();
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('tabindex', '0');
  }
});

test('phone: the focus ring on a tab is not cut off by the scrolling tab strip', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const ringFits = async (selector: string) => {
    const strip = page.locator(selector).first();
    await expect(strip).toBeVisible();
    const item = strip.locator('button, a').nth(1);
    await item.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    return page.evaluate(([sel]) => {
      const el = document.activeElement as HTMLElement;
      const box = el.closest(sel!)!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ring = Math.max(0, parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset));
      return { ring, above: r.top - ring - box.top, below: box.bottom - (r.bottom + ring), style: cs.outlineStyle };
    }, [selector]);
  };
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  const a = await ringFits('.tabs');
  expect(a.style).not.toBe('none');
  expect(a.above, 'ring above the tab').toBeGreaterThanOrEqual(-0.5);
  expect(a.below, 'ring below the tab').toBeGreaterThanOrEqual(-0.5);
  await page.goto('/billing');
  const b = await ringFits('.tabbar');
  expect(b.style).not.toBe('none');
  expect(b.above, 'ring above the link').toBeGreaterThanOrEqual(-0.5);
  expect(b.below, 'ring below the link').toBeGreaterThanOrEqual(-0.5);
  await shot(page, 'phone-tab-focus');
});
