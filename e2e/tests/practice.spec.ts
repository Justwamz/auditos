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

  // The firm administrator has no prospects.
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'wanjiru.mugo@kangethe.example.test');
  await expect(admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Prospects' })).toHaveCount(0);
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
  // One event reads "1 event", and a staff member has no person selector (the page has finished loading by now).
  const cell = brian.locator(`[data-day="${nairobiDay(2)}"]`).first();
  await expect(cell).toContainText('1 event');
  await expect(cell).not.toContainText('events');
  await expect(brian.getByLabel('Show', { exact: true })).toHaveCount(0);

  // The legend hides and restores a kind in the month cells and in the day panel.
  const fieldwork = brian.locator('.cal-legend').getByRole('button', { name: 'Fieldwork', exact: true });
  await expect(fieldwork).toHaveAttribute('aria-pressed', 'true');
  await fieldwork.click();
  await expect(fieldwork).toHaveAttribute('aria-pressed', 'false');
  await expect(cell).not.toContainText('event');
  await expect(panel.getByText('Fieldwork: Mwangaza stock count')).toHaveCount(0);
  await expect(panel.getByText('Everything on this day is hidden by your filters. Show all kinds to see it.')).toBeVisible();
  await fieldwork.click();
  await expect(fieldwork).toHaveAttribute('aria-pressed', 'true');
  await expect(cell).toContainText('1 event');
  await expect(panel.getByText('Fieldwork: Mwangaza stock count').first()).toBeVisible();

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
  await expect(grace.locator(`[data-day="${nairobiDay(2)}"]`).first()).toContainText(/[2-9] events/);

  // The partner's own group is open and everyone else's is folded.
  const panel = await openDay(grace, nairobiDay(7));
  const groups = panel.locator('.cal-person > .disclosure > .disclosure-btn');
  const own = groups.filter({ hasText: 'Grace Kangethe' });
  await expect(own).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Management meeting').first()).toBeVisible();
  // Only her own group is open; every other person is folded.
  await expect(groups.filter({ hasText: 'Grace Kangethe' })).toHaveCount(1);
  await expect(panel.locator('.cal-person > .disclosure > .disclosure-btn[aria-expanded="true"]')).toHaveText(/Grace Kangethe/);
  await expect(panel.locator('.cal-person > .disclosure > .disclosure-btn[aria-expanded="true"]')).toHaveCount(1);
  await expect(groups.nth(1)).toHaveAttribute('aria-expanded', 'false');
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

test('an event can be added, changed and cancelled from the calendar', async ({ browser }) => {
  test.slow();
  const brian = await calendarOf(browser, 'brian.kiptoo@kangethe.example.test');
  const panel = await openDay(brian, nairobiDay(4));
  await brian.getByRole('button', { name: '+ New event' }).click();
  const dialog = brian.getByRole('dialog', { name: 'New event' });
  await dialog.getByLabel('Title').fill('Check-in with Faith');
  await dialog.getByRole('button', { name: 'Add to calendar' }).click();
  await expect(brian.getByText('Event added to the calendar.')).toBeVisible();
  const row = panel.getByRole('button', { name: /Check-in with Faith/ }).first();
  await row.click();
  await panel.getByRole('button', { name: 'Edit' }).click();
  const change = brian.getByRole('dialog', { name: 'Change the event' });
  await change.getByLabel('Title').fill('Check-in with Faith and Tom');
  await change.getByRole('button', { name: 'Save changes' }).click();
  await expect(brian.getByText('Event updated.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Check-in with Faith and Tom/ }).first()).toBeVisible();
  await panel.getByRole('button', { name: /Check-in with Faith and Tom/ }).first().click();
  await panel.getByRole('button', { name: 'Cancel event' }).click();
  await expect(brian.getByText('Check-in with Faith and Tom cancelled.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Check-in with Faith/ })).toHaveCount(0);
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

const viewOf = async (page: Page, name: 'Day' | 'Work week' | 'Week' | 'Month') => {
  await page.getByRole('radiogroup', { name: 'How to show the calendar' }).getByRole('radio', { name, exact: true }).click();
  await expect(page.getByRole('radio', { name, exact: true })).toBeChecked();
};
/** The column of one day in a time grid, and the strip cell above it. */
const colOf = (page: Page, day: string) => page.locator(`.cal-col[data-col="${day}"]`);
const stripOf = (page: Page, day: string) => page.locator(`.cal-strip-cell[data-col="${day}"]`);
type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('Work week and Week show an hourly grid with event blocks and side-by-side overlaps', async ({ browser }) => {
  test.slow();
  const grace = await calendarOf(browser, 'grace.kangethe@kangethe.example.test');
  await viewOf(grace, 'Work week');
  await expect(grace.locator('.cal-col')).toHaveCount(5);
  // Hours from 07:00 are showing; the grid scrolls to the whole day.
  await expect(grace.locator('.cal-hour', { hasText: '07:00' })).toBeVisible();
  await expect(grace.locator('.cal-hour', { hasText: '00:00' })).toHaveCount(1);
  expect(await grace.locator('.cal-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(200);

  // Two events at once sit side by side and never overlap.
  const stock = colOf(grace, nairobiDay(2)).locator('.cal-block', { hasText: 'Mwangaza stock count' });
  const review = colOf(grace, nairobiDay(2)).locator('.cal-block', { hasText: 'Partner review: Savannah planning' });
  await expect(stock).toBeVisible();
  await expect(review).toBeVisible();
  expect(intersects((await stock.boundingBox())!, (await review.boundingBox())!)).toBe(false);
  // A block says its kind in words as well as colour.
  await expect(stock).toContainText('Fieldwork');

  // Next week holds the management meeting, in both Work week and Week.
  await grace.getByRole('button', { name: 'Next week' }).click();
  await grace.waitForLoadState('networkidle');
  await expect(colOf(grace, nairobiDay(7)).locator('.cal-block', { hasText: 'Management meeting' })).toBeVisible();
  await viewOf(grace, 'Week');
  await expect(grace.locator('.cal-col')).toHaveCount(7);
  await expect(colOf(grace, nairobiDay(7)).locator('.cal-block', { hasText: 'Management meeting' })).toBeVisible();
  await grace.getByRole('button', { name: 'Previous week' }).click();
  await grace.waitForLoadState('networkidle');
  await expect(colOf(grace, nairobiDay(2)).locator('.cal-block', { hasText: 'Mwangaza stock count' })).toBeVisible();
  // The choice is remembered.
  await grace.reload();
  await expect(grace.getByRole('radio', { name: 'Week', exact: true })).toBeChecked();
});

test('an all-day leave sits in the strip above the hours, not on the grid', async ({ browser }) => {
  test.slow();
  const tom = await calendarOf(browser, 'tom.odhiambo@kangethe.example.test');
  await viewOf(tom, 'Work week');
  await expect(stripOf(tom, nairobiDay(3)).getByText('Annual leave')).toBeVisible();
  await expect(stripOf(tom, nairobiDay(4)).getByText('Annual leave')).toBeVisible();
  await expect(tom.locator('.cal-col .cal-block', { hasText: 'Annual leave' })).toHaveCount(0);
  // The leave also runs into Saturday, which Work week does not draw: a hint says so and Week shows it.
  await expect(tom.locator('.cal-hint')).toContainText('1 event on the weekend. Switch to Week to see it.');
  await tom.getByRole('button', { name: 'Show the whole week' }).click();
  await expect(tom.getByRole('radio', { name: 'Week', exact: true })).toBeChecked();
  await expect(stripOf(tom, nairobiDay(5)).getByText('Annual leave')).toBeVisible();
  await expect(tom.locator('.cal-hint')).toHaveCount(0);
});

test('a block opens the details; Edit and Cancel are only for the person who made the event', async ({ browser }) => {
  test.slow();
  const faith = await calendarOf(browser, 'faith.njeri@kangethe.example.test');
  await viewOf(faith, 'Work week');
  await colOf(faith, nairobiDay(2)).locator('.cal-block', { hasText: 'Mwangaza stock count' }).click();
  const seen = faith.getByRole('dialog', { name: /Mwangaza stock count/ });
  await expect(seen.getByText('Client warehouse')).toBeVisible();
  await expect(seen.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(seen.getByRole('button', { name: 'Cancel event' })).toHaveCount(0);
  await faith.keyboard.press('Escape');
  await expect(seen).toHaveCount(0);

  const brian = await calendarOf(browser, 'brian.kiptoo@kangethe.example.test');
  await viewOf(brian, 'Work week');
  await colOf(brian, nairobiDay(2)).locator('.cal-block', { hasText: 'Mwangaza stock count' }).click();
  const mine = brian.getByRole('dialog', { name: /Mwangaza stock count/ });
  await expect(mine.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(mine.getByRole('button', { name: 'Cancel event' })).toBeVisible();
});

test('Day shows one day and the arrows move a day at a time; staff have no "See by person"', async ({ browser }) => {
  test.slow();
  const brian = await calendarOf(browser, 'brian.kiptoo@kangethe.example.test');
  await viewOf(brian, 'Day');
  await expect(brian.locator('.cal-col')).toHaveCount(1);
  const before = await brian.locator('.cal-month-title').textContent();
  await brian.getByRole('button', { name: 'Next day' }).click();
  await expect(brian.locator('.cal-month-title')).not.toHaveText(before!);
  await brian.getByRole('button', { name: 'Previous day' }).click();
  await expect(brian.locator('.cal-month-title')).toHaveText(before!);
  await expect(brian.getByRole('button', { name: 'See by person' })).toHaveCount(0);
  await expect(brian.getByLabel('Show', { exact: true })).toHaveCount(0);
});

test('a partner sees one column per person on a shared hour grid', async ({ browser }) => {
  test.slow();
  const grace = await calendarOf(browser, 'grace.kangethe@kangethe.example.test');
  await viewOf(grace, 'Work week');
  const short = new Date(`${nairobiDay(2)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  await grace.getByRole('button', { name: `Open ${short}` }).click();
  await expect(grace.getByRole('radio', { name: 'Day', exact: true })).toBeChecked();
  const toggle = grace.getByRole('button', { name: 'See by person' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const heads = grace.locator('.cal-person-head');
  await expect(heads).toHaveCount(4);
  await expect(heads.filter({ hasText: 'Brian Kiptoo' })).toHaveCount(1);
  await expect(heads.filter({ hasText: 'Faith Njeri' })).toHaveCount(1);
  await expect(heads.filter({ hasText: 'Tom Odhiambo' })).toHaveCount(0);
  await expect(grace.locator(`.cal-col[data-name="Brian Kiptoo"]`).locator('.cal-block', { hasText: 'Mwangaza stock count' })).toBeVisible();
  await expect(grace.locator(`.cal-col[data-name="Faith Njeri"]`).locator('.cal-block', { hasText: 'Mwangaza stock count' })).toBeVisible();
  // Choosing another view goes back to the normal grid.
  await viewOf(grace, 'Week');
  await expect(grace.locator('.cal-person-head')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('midnight-spanning, all-day and zero-length events are laid out sensibly', async ({ browser }) => {
  const d1 = nairobiDay(1);
  const d2 = nairobiDay(2);
  const mk = (n: number, title: string, startsAt: string, endsAt: string, allDay = false) => ({
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, title, kind: 'meeting', startsAt, endsAt, allDay, location: null, notes: null,
    clientId: null, clientName: null, engagementId: null, attendees: [], createdBy: '10000000-0000-4000-8000-000000000001', createdByName: 'Grace Kangethe', mine: false,
  });
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await page.route(/\/api\/calendar\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      json: {
        events: [
          mk(1, 'Late close', `${d1}T22:00:00+03:00`, `${d2}T02:00:00+03:00`),
          mk(2, 'Reminder', `${d1}T10:00:00+03:00`, `${d1}T10:00:00+03:00`),
          mk(3, 'Office closed', `${d1}T00:00:00+03:00`, `${d1}T23:59:00+03:00`, true),
        ],
        milestones: [{ date: d2, title: 'Mwangaza report date', engagementId: 'e1', kind: 'report' }],
      },
    });
  });
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  await viewOf(page, 'Week');
  // The late close is cut at midnight and shows on both days.
  await expect(colOf(page, d1).locator('.cal-block', { hasText: 'Late close' })).toHaveCount(1);
  await expect(colOf(page, d2).locator('.cal-block', { hasText: 'Late close' })).toHaveCount(1);
  // A reminder with no length still has a block you can see and click.
  const reminder = (await colOf(page, d1).locator('.cal-block', { hasText: 'Reminder' }).boundingBox())!;
  expect(reminder.height).toBeGreaterThanOrEqual(20);
  // The all-day event is in the strip and not on the grid; the date mark is a read-only diamond there.
  await expect(stripOf(page, d1).getByText('Office closed')).toBeVisible();
  await expect(page.locator('.cal-col .cal-block', { hasText: 'Office closed' })).toHaveCount(0);
  const mark = stripOf(page, d2).locator('.cal-milestone', { hasText: 'Mwangaza report date' });
  await expect(mark.locator('.cal-diamond')).toBeVisible();
  await expect(mark.getByRole('button')).toHaveCount(0);
});

test('crowded blocks stay readable: whole words only, never empty, and the name is always reachable', async ({ browser }) => {
  const d1 = nairobiDay(1);
  const d2 = nairobiDay(2);
  const mk = (n: number, title: string, from: string, to: string, day: string, kind = 'meeting', by = 1) => ({
    id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`, title, kind, startsAt: `${day}T${from}:00+03:00`, endsAt: `${day}T${to}:00+03:00`, allDay: false,
    location: null, notes: null, clientId: null, clientName: null, engagementId: null, attendees: [], createdBy: `10000000-0000-4000-8000-0000000000${String(by).padStart(2, '0')}`, createdByName: by === 1 ? 'Grace Kangethe' : `Person ${by}`, mine: false,
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await page.route(/\/api\/calendar\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      json: {
        events: [
          mk(1, 'Quarterly stocktake review', '09:00', '11:00', d1),
          mk(2, 'Client call with finance', '10:00', '12:00', d1, 'training'),
          mk(3, 'Long fieldwork day at the warehouse', '08:00', '17:00', d1, 'fieldwork'),
          mk(4, 'Planning session for next month', '09:00', '10:00', d2),
          mk(5, 'Team stand-up', '09:00', '09:30', d1, 'meeting', 2),
          mk(6, 'Team stand-up', '09:00', '09:30', d1, 'meeting', 3),
          mk(7, 'Team stand-up', '09:00', '09:30', d1, 'meeting', 4),
          mk(8, 'Team stand-up', '09:00', '09:30', d1, 'meeting', 5),
        ],
        milestones: [],
      },
    });
  });
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  const check = async () => {
    const blocks = page.locator('.cal-block');
    expect(await blocks.count()).toBeGreaterThan(3);
    let compact = 0;
    for (const block of await blocks.all()) {
      const info = await block.evaluate((el) => {
        const title = el.querySelector('.cal-block-title') as HTMLElement;
        const when = el.querySelector('.cal-block-when') as HTMLElement;
        const icon = el.querySelector('.cal-block-icon') as HTMLElement;
        return {
          width: el.getBoundingClientRect().width,
          titleShown: title.getBoundingClientRect().width > 2, whenShown: when.getBoundingClientRect().width > 2,
          iconShown: icon.getBoundingClientRect().width > 2 && (icon.textContent ?? '').trim().length > 0,
          wrap: getComputedStyle(title).overflowWrap, brk: getComputedStyle(title).wordBreak,
          short: el.classList.contains('is-short'), titleFits: title.scrollWidth <= title.clientWidth + 1,
          // The time text must end inside the block's content box (the block clips what runs past it).
          whenFits: (() => {
            const r = document.createRange();
            r.selectNodeContents(when);
            const box = el.getBoundingClientRect();
            const room = box.right - parseFloat(getComputedStyle(el).paddingRight);
            return r.getBoundingClientRect().right <= room + 0.5;
          })(),
          name: el.getAttribute('aria-label') ?? '', text: title.textContent ?? '', time: when.textContent ?? '',
        };
      });
      expect(info.width).toBeGreaterThan(14);
      expect(info.iconShown).toBe(true);
      // The accessible name always carries the kind, the whole title and the time.
      expect(info.name).toContain(info.text);
      expect(info.name).toContain(info.time);
      if (info.titleShown) {
        expect(info.wrap).toBe('normal');
        expect(info.brk).toBe('normal');
        // A one-line (short) block may end its title with an ellipsis; a wrapped title never runs past its box.
        if (!info.short) expect(info.titleFits).toBe(true);
      }
      // A time is either fully readable or not shown at all, never cut off.
      if (info.whenShown) expect(info.whenFits).toBe(true);
      if (!info.whenShown) { compact += 1; expect(info.titleShown).toBe(false); }
    }
    return compact;
  };
  for (const view of ['Work week', 'Week'] as const) {
    await viewOf(page, view);
    expect(await check()).toBeGreaterThan(0);
    // A block on its own keeps its whole title in view.
    const alone = colOf(page, d2).locator('.cal-block');
    expect(((await alone.boundingBox())!).width).toBeGreaterThan(100);
    await expect(alone.locator('.cal-block-title')).toBeVisible();
    // A squeezed block can be focused with the keyboard and opens its details.
    const squeezed = colOf(page, d1).locator('.cal-block').first();
    await squeezed.focus();
    await expect(squeezed).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  // The same holds in the person columns.
  const short = new Date(`${d1}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  await page.getByRole('button', { name: `Open ${short}` }).click();
  await page.getByRole('button', { name: 'See by person' }).click();
  await expect(page.locator('.cal-person-head')).toHaveCount(5);
  expect(await check()).toBeGreaterThan(0);
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
