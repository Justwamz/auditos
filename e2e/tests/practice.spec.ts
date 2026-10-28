import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
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
  // The page has finished loading (see names above), so a missing person filter really means staff do not get one.
  await expect(brian.getByLabel('Search prospects')).toBeVisible();
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

const DANIEL = 'daniel.otieno@kangethe.example.test';

// Signing in takes a fresh one-time code each time, so the new tests share one sign-in.
let danielState: Awaited<ReturnType<Page['context']>['storageState']> | undefined;
async function daniel(browser: Browser): Promise<Page> {
  if (!danielState) {
    const first = await (await browser.newContext()).newPage();
    await signIn(first, DANIEL);
    danielState = await first.context().storageState();
  }
  return (await browser.newContext({ storageState: danielState })).newPage();
}

/** Opens the prospects page and waits until it has finished loading, so "not there" checks mean something. */
async function openProspects(browser: Browser, email: string): Promise<Page> {
  const page = email === DANIEL ? await daniel(browser) : await (await browser.newContext()).newPage();
  if (email !== DANIEL) await signIn(page, email);
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Prospects', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Search prospects')).toBeVisible();
  await page.waitForLoadState('networkidle');
  return page;
}
const tableNames = (page: Page) => page.locator('.prospects-table .prospect-name');
const chipCount = (page: Page, label: string) => page.locator('.chip', { hasText: label }).locator('.chip-count');
const noJunk = async (page: Page) => {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\b(null|undefined|NaN)\b/);
};

test('stage chip, person filter and search work together and the counts follow them', async ({ browser }) => {
  const page = await openProspects(browser, DANIEL);
  await expect(tableNames(page)).toHaveCount(5);
  await expect(chipCount(page, 'All open')).toHaveText('5');
  await expect(page.getByText('Won 0 · Lost 1')).toBeVisible();

  // Person filter alone: Ruth owns one open prospect and the lost one.
  await page.getByLabel('Show prospects of').selectOption({ label: 'Ruth Wambui' });
  await expect(tableNames(page)).toHaveText(['Tembo Apartments Ltd']);
  await expect(chipCount(page, 'All open')).toHaveText('1');
  await expect(chipCount(page, 'Lead')).toHaveText('1');
  await expect(chipCount(page, 'Proposal sent')).toHaveText('0');
  await expect(chipCount(page, 'Engagement letter sent')).toHaveText('0');
  await expect(page.getByText('Won 0 · Lost 1')).toBeVisible();

  // Person and stage together find nothing.
  await page.getByRole('button', { name: /^Proposal sent/ }).click();
  await expect(page.getByText('No prospects match')).toBeVisible();
  await page.getByRole('button', { name: 'Show everything' }).click();
  await expect(tableNames(page)).toHaveCount(5);
  await expect(page.getByLabel('Show prospects of')).toHaveValue('');

  // Stage and search together (search also finds the owner's name).
  await page.getByRole('button', { name: /^Lead/ }).click();
  await page.getByLabel('Search prospects').fill('ruth');
  await expect(tableNames(page)).toHaveText(['Tembo Apartments Ltd']);
  await page.getByLabel('Search prospects').fill('mlima');
  await expect(page.getByText('No prospects match')).toBeVisible();
  await page.getByRole('button', { name: /^All open/ }).click();
  await expect(tableNames(page)).toHaveText(['Mlima Coffee Cooperative']);

  // A search that only matches a closed prospect says so, and shows it.
  await page.getByLabel('Search prospects').fill('pwani');
  await expect(page.getByText('No prospects match')).toBeVisible();
  await expect(page.getByText('You can see them under Closed below.')).toBeVisible();
  await expect(page.getByText('Pwani Fisheries Ltd')).toBeVisible();
});

test('the cards view totals follow the filter', async ({ browser }) => {
  const page = await openProspects(browser, DANIEL);
  await page.getByRole('radio', { name: 'Cards' }).click();
  const head = (label: string) => page.locator('.prospects-stage-head', { hasText: label });
  await expect(head('Lead')).toContainText('3 prospects · KES 1,220,000');
  await expect(head('Proposal sent')).toContainText('1 prospect · KES 620,000');
  await expect(head('Engagement letter sent')).toContainText('1 prospect · KES 950,000');

  await page.getByLabel('Show prospects of').selectOption({ label: 'Ruth Wambui' });
  await expect(head('Lead')).toContainText('1 prospect · KES 540,000');
  await expect(head('Proposal sent')).toHaveCount(0);
  await expect(chipCount(page, 'Lead')).toHaveText('1');
  await expect(chipCount(page, 'Proposal sent')).toHaveText('0');
});

test('a prospect with nothing filled in shows plain words, never null or NaN', async ({ browser }) => {
  const page = await daniel(browser);
  await page.route('**/api/prospects', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { prospects: Record<string, unknown>[] };
    const first = body.prospects.find((p) => p.name === 'Baraka Hauliers Ltd')!;
    Object.assign(first, { sector: null, contactName: null, expectedFee: null, expectedStart: null, notes: null });
    return route.fulfill({ response: res, json: body });
  });
  await page.goto('/pipeline');
  await expect(tableNames(page).first()).toBeVisible();
  const row = page.locator('tr.prospects-row', { hasText: 'Baraka Hauliers Ltd' });
  await expect(row).toContainText('No fee yet');
  await expect(row).toContainText('Not set');
  await row.locator('.prospect-name').click();
  await expect(row.getByText('Not given')).toHaveCount(2);
  await noJunk(page);
  await page.getByRole('radio', { name: 'Cards' }).click();
  await expect(page.locator('.prospects-card', { hasText: 'Baraka Hauliers Ltd' })).toContainText('No details yet');
  await noJunk(page);
});

test('the lost, hand-over and make-a-client panels refuse incomplete answers', async ({ browser }) => {
  const page = await openProspects(browser, DANIEL);
  const menuFor = (name: string) => page.getByRole('button', { name: `Actions for ${name}` });
  const dialog = page.getByRole('dialog');

  await menuFor('Tembo Apartments Ltd').click();
  await page.getByRole('menuitem', { name: 'Mark as lost' }).click();
  await dialog.getByLabel('Why was it lost?').fill('abc');
  await dialog.getByRole('button', { name: 'Mark as lost' }).click();
  await expect(dialog).toBeVisible();
  expect(await dialog.getByLabel('Why was it lost?').evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true);
  await page.keyboard.press('Escape');

  await menuFor('Tembo Apartments Ltd').click();
  await page.getByRole('menuitem', { name: 'Hand over' }).click();
  await dialog.getByLabel('Why? (recorded)').fill('abc');
  await dialog.getByRole('button', { name: 'Hand over' }).click();
  await expect(dialog).toBeVisible();
  expect(await dialog.getByLabel('New owner').evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true);
  await page.keyboard.press('Escape');

  await menuFor('Tembo Apartments Ltd').click();
  await page.getByRole('menuitem', { name: 'Make a client' }).click();
  await dialog.getByLabel('Legal form').fill('');
  await dialog.getByRole('button', { name: 'Create the client' }).click();
  await expect(dialog).toBeVisible();
  expect(await dialog.getByLabel('Legal form').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The same actions are in the opened row.
  const row = page.locator('tr.prospects-row', { hasText: 'Tembo Apartments Ltd' });
  await row.locator('.prospect-name').click();
  await row.getByRole('button', { name: 'Hand over' }).click();
  await expect(dialog.getByRole('heading', { name: 'Hand over Tembo Apartments Ltd' })).toBeVisible();
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: 'Make a client' }).click();
  await expect(dialog.getByRole('heading', { name: 'Make Tembo Apartments Ltd a client' })).toBeVisible();
  await page.keyboard.press('Escape');
  await row.getByLabel('Move to').selectOption('lost');
  await expect(dialog.getByRole('heading', { name: 'Why was Tembo Apartments Ltd lost?' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a very long name and long notes stay inside the row and the card; a prospect can be added and then marked as lost', async ({ browser }) => {
  const long = 'W'.repeat(120);
  const page = await daniel(browser);
  await page.route('**/api/prospects', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { prospects: Record<string, unknown>[] };
    for (const p of body.prospects) if (p.name === long) p.notes = 'N'.repeat(300);
    return route.fulfill({ response: res, json: body });
  });
  await page.goto('/pipeline');
  await expect(tableNames(page).first()).toBeVisible();

  await page.getByRole('button', { name: '+ Add a prospect' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(long);
  await page.getByRole('dialog').getByRole('button', { name: 'Add prospect' }).click();
  await expect(page.getByText(`${long} added to your prospects.`)).toBeVisible();

  const inside = async (inner: Locator, outer: Locator) => {
    const a = (await inner.boundingBox())!;
    const b = (await outer.boundingBox())!;
    expect(a.x).toBeGreaterThanOrEqual(b.x - 1);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 1);
  };
  const noSideScroll = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const row = page.locator('tr.prospects-row', { hasText: long });
  await row.locator('.prospect-name').click();
  await expect(row.getByText('N'.repeat(300))).toBeVisible();
  await inside(row.getByRole('button', { name: `Actions for ${long}` }), page.locator('.prospects-sheet'));
  await noSideScroll();

  await page.getByRole('radio', { name: 'Cards' }).click();
  const card = page.locator('.prospects-card', { hasText: long });
  await inside(card.getByRole('button', { name: `Actions for ${long}` }), card);
  await noSideScroll();

  // Marking it as lost works and moves it to Closed.
  await card.getByRole('button', { name: `Actions for ${long}` }).click();
  await page.getByRole('menuitem', { name: 'Mark as lost' }).click();
  await page.getByRole('dialog').getByLabel('Why was it lost?').fill('Went with another firm');
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as lost' }).click();
  await expect(page.getByText(`${long} marked as lost.`)).toBeVisible();
  await expect(page.locator('.prospects-card', { hasText: long })).toHaveCount(0);
  await expect(page.getByText('Won 0 · Lost 2')).toBeVisible();
});

test('moving a prospect from the menu or from its opened row updates the chips', async ({ browser }) => {
  const page = await openProspects(browser, DANIEL);
  await expect(chipCount(page, 'Lead')).toHaveText('3');
  await expect(chipCount(page, 'Proposal sent')).toHaveText('1');

  await page.getByRole('button', { name: 'Actions for Kito Logistics Ltd' }).click();
  await page.getByRole('menuitem', { name: 'Move to Proposal sent' }).click();
  await expect(page.getByText('Kito Logistics Ltd moved to Proposal sent.')).toBeVisible();
  await expect(chipCount(page, 'Lead')).toHaveText('2');
  await expect(chipCount(page, 'Proposal sent')).toHaveText('2');

  const row = page.locator('tr.prospects-row', { hasText: 'Kito Logistics Ltd' });
  await row.locator('.prospect-name').click();
  await row.getByLabel('Move to').selectOption('loe_sent');
  await expect(page.getByText('Kito Logistics Ltd moved to Engagement letter sent.')).toBeVisible();
  await expect(chipCount(page, 'Proposal sent')).toHaveText('1');
  await expect(chipCount(page, 'Engagement letter sent')).toHaveText('2');
});

// Seeded events are relative to the run date (see demo-data.ts): the week's Monday plus an offset, in Nairobi time.
const nairobiDay = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow) + offset);
  return d.toISOString().slice(0, 10);
};

const calendarOf = async (browser: Browser, email: string) => {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  return page;
};

/** Opens the day in the month grid (moving to the next month when the day is not on this one) and returns the day panel. */
const openDay = async (page: Page, day: string) => {
  if ((await page.locator(`[data-day="${day}"]`).count()) === 0) {
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.waitForLoadState('networkidle');
  }
  await page.locator(`[data-day="${day}"]`).first().click();
  return page.locator('.cal-panel');
};

test('the calendar opens on the month with a toolbar and a day panel', async ({ browser }) => {
  test.slow();
  const brian = await calendarOf(browser, 'brian.kiptoo@kangethe.example.test');
  await expect(brian.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  await expect(brian.getByRole('button', { name: 'Previous month' })).toBeVisible();
  await expect(brian.getByRole('button', { name: 'Next month' })).toBeVisible();
  const views = brian.getByRole('radiogroup', { name: 'How to show the calendar' });
  for (const name of ['Day', 'Work week', 'Week', 'Month']) await expect(views.getByRole('radio', { name, exact: true })).toBeVisible();
  await expect(views.getByRole('radio', { name: 'Month', exact: true })).toBeChecked();

  const panel = await openDay(brian, nairobiDay(2));
  await expect(panel.getByText('Fieldwork: Mwangaza stock count').first()).toBeVisible();
  await expect(brian.getByText('Pre-planning meeting: Savannah Farms')).toHaveCount(0);
  // Brian made it, so Edit and Cancel are his.
  await panel.getByRole('button', { name: /Fieldwork: Mwangaza stock count/ }).first().click();
  await expect(panel.getByText('Client warehouse').first()).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Cancel event' })).toBeVisible();

  // Faith is only invited, so she can read it and change nothing.
  const faith = await calendarOf(browser, 'faith.njeri@kangethe.example.test');
  const fpanel = await openDay(faith, nairobiDay(2));
  await fpanel.getByRole('button', { name: /Fieldwork: Mwangaza stock count/ }).first().click();
  await expect(fpanel.getByText('Client warehouse').first()).toBeVisible();
  await expect(fpanel.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(fpanel.getByRole('button', { name: 'Cancel event' })).toHaveCount(0);

  const tom = await calendarOf(browser, 'tom.odhiambo@kangethe.example.test');
  const leave = await openDay(tom, nairobiDay(3));
  await expect(leave.getByText('Annual leave').first()).toBeVisible();
  const fieldworkDay = await openDay(tom, nairobiDay(2));
  await expect(fieldworkDay.getByText('Fieldwork: Mwangaza stock count')).toHaveCount(0);
});

test('the day panel groups a partner day by person', async ({ browser }) => {
  test.slow();
  const grace = await calendarOf(browser, 'grace.kangethe@kangethe.example.test');
  // Several people on one day: the cell says how many events.
  await expect(grace.locator(`[data-day="${nairobiDay(2)}"]`).first()).toContainText('2 events');

  // The partner's own group is open and everyone else's is folded.
  const panel = await openDay(grace, nairobiDay(7));
  const own = panel.getByRole('button', { name: /Grace Kangethe/ });
  await expect(own).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Management meeting').first()).toBeVisible();
  await expect(panel.locator('.cal-person > .disclosure > .disclosure-btn[aria-expanded="false"]')).toHaveCount(3);
  await expect(grace.getByLabel('Show', { exact: true })).toBeVisible();
});

test('"+ New event" opens a dialog that Escape closes, and the firm administrator cannot schedule', async ({ browser }) => {
  const brian = await calendarOf(browser, 'brian.kiptoo@kangethe.example.test');
  const button = brian.getByRole('button', { name: '+ New event' });
  await button.click();
  const dialog = brian.getByRole('dialog', { name: 'New event' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Title')).toBeFocused();
  for (const f of ['Title', 'Kind', 'Date', 'From', 'To', 'Where', 'Client', 'Engagement']) await expect(dialog.getByLabel(f, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('All day')).toBeVisible();
  await brian.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  const admin = await calendarOf(browser, 'wanjiru.mugo@kangethe.example.test');
  await expect(admin.getByRole('button', { name: '+ New event' })).toHaveCount(0);
});

test('a busy day says how many events, never overflows, and shows milestones as read-only diamonds', async ({ browser }) => {
  const day = nairobiDay(1);
  const pad = (i: number) => String(i).padStart(2, '0');
  const mk = (i: number) => ({
    id: `00000000-0000-4000-8000-0000000000${pad(i)}`, title: `Busy event ${i}`, kind: 'meeting',
    startsAt: `${day}T09:00:00+03:00`, endsAt: `${day}T10:00:00+03:00`, allDay: false, location: null, notes: null, clientId: null, clientName: null, engagementId: null,
    attendees: [], createdBy: `10000000-0000-4000-8000-0000000000${pad(i)}`, createdByName: `Person ${i}`, mine: false,
  });
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await page.route(/\/api\/calendar\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ json: { events: Array.from({ length: 12 }, (_, i) => mk(i)), milestones: [{ date: day, title: 'Mwangaza report date', engagementId: 'e1', kind: 'report' }] } });
  });
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  const panel = await openDay(page, day);
  const cell = page.locator(`[data-day="${day}"]`).first();
  await expect(cell).toContainText('12 events');
  expect(await cell.locator('.cal-dot').count()).toBeLessThanOrEqual(6);
  const box = await cell.boundingBox();
  const last = await cell.locator('.cal-dot').last().boundingBox();
  expect(last!.x + last!.width).toBeLessThanOrEqual(box!.x + box!.width);
  // The milestone is a diamond with no Edit or Cancel of its own.
  const milestone = panel.locator('.cal-milestone', { hasText: 'Mwangaza report date' });
  await expect(milestone).toBeVisible();
  await expect(milestone.locator('.cal-diamond')).toBeVisible();
  await expect(milestone.getByRole('button')).toHaveCount(0);
  // A day with nothing on it shows nothing.
  await expect(page.locator(`[data-day="${nairobiDay(5)}"]`).first()).not.toContainText('event');
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
