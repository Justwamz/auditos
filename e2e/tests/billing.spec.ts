import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { BANNED, signIn } from '../helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
// A main button is a filled one: not secondary, quiet or danger, not a chip, not an accordion header.
const MAIN = 'main button:visible:not(.secondary):not(.quiet):not(.danger):not(.chip):not(.disclosure-btn):not(.row-menu-btn)';
const PRACTICE = 'PRACTICE ONLY: this invoice has not been sent to KRA and is not a valid tax invoice';
const plain = async (page: Page, label: string) => {
  const text = await page.locator('main').innerText();
  for (const re of BANNED) expect(text, `${label} contains ${re}`).not.toMatch(re);
};
const open = async (page: Page, path: string, heading: string) => {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
};

test('staff log time and expenses but see no billing, rates or invoices', async ({ page }) => {
  await signIn(page, 'brian.kiptoo@kangethe.example.test');
  await expect(nav(page).getByRole('link', { name: 'Timesheet' })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Billing' })).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: 'Invoices' })).toHaveCount(0);

  await open(page, '/timesheet', 'Timesheet');
  // One main button; the week bar and the totals sit above the tables.
  await expect(page.getByRole('button', { name: '+ Log time' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Record expense' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
  await expect(page.getByText(/logged/).first()).toBeVisible();
  await expect(page.getByLabel('Time (hours)')).toHaveCount(0);

  const daily = page.getByRole('list', { name: 'Daily totals' }).getByRole('listitem');
  await expect(daily).toHaveCount(7);
  await expect(daily.filter({ hasText: '(today)' })).toHaveCount(1);
  const range = page.locator('.cal-month-title');
  const thisWeek = await range.textContent();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(range).not.toHaveText(thisWeek ?? '');
  await expect(daily.filter({ hasText: '(today)' })).toHaveCount(0);
  await expect(daily.filter({ hasText: '0h 00m' })).toHaveCount(7);
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(range).toHaveText(thisWeek ?? '');
  await expect(daily.filter({ hasText: '(today)' })).toHaveCount(1);

  // Invalid hours: the error shows once and the panel stays open.
  await page.getByRole('button', { name: '+ Log time' }).click();
  const bad = page.getByRole('dialog', { name: 'Log time' });
  await bad.getByLabel('Time (hours)').fill('abc');
  await bad.getByLabel('What you did').fill('Browser test: bad hours');
  await bad.getByRole('button', { name: 'Log time', exact: true }).click();
  await expect(bad.getByText('Enter the time as hours, for example 1.5, or as 1:30.')).toHaveCount(1);
  await expect(bad).toBeVisible();
  await bad.getByRole('button', { name: 'Cancel' }).click();
  await expect(bad).toHaveCount(0);

  // The week's total depends on the seed date, so read it first and expect exactly 1h 30m more.
  const minutes = (t: string) => { const m = /(\d+)h (\d\d)m/.exec(t)!; return Number(m[1]) * 60 + Number(m[2]); };
  const before = minutes((await page.getByText(/\d+h \d\dm logged/).first().textContent()) ?? '');
  const after = `${Math.floor((before + 90) / 60)}h ${String((before + 90) % 60).padStart(2, '0')}m`;
  const stamp = Date.now();
  const doing = `Browser test: attendance at the stock count ${stamp}`;
  await page.getByRole('button', { name: '+ Log time' }).click();
  const panel = page.getByRole('dialog', { name: 'Log time' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Engagement', { exact: true }).selectOption({ index: 1 });
  await panel.getByLabel('Time (hours)').fill('1:30');
  await panel.getByLabel('What you did').fill(doing);
  await panel.getByRole('button', { name: 'Log time', exact: true }).click();
  await expect(page.getByText('Logged 1h 30m.')).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Log time' })).toBeFocused();
  await expect(page.getByRole('row', { name: new RegExp(doing) })).toHaveCount(1);
  await expect(page.getByText(/KES [\d,]+\.\d\d/)).toHaveCount(0);
  await expect(page.getByText(after, { exact: true }).first()).toBeVisible();
  await expect(daily.filter({ hasText: '(today)' })).toContainText('1h 30m');

  const spent = `Browser test: fuel to the client ${stamp}`;
  await page.getByRole('button', { name: '+ Record expense' }).click();
  const xpanel = page.getByRole('dialog', { name: 'Record an expense' });
  await expect(xpanel).toBeVisible();
  await xpanel.getByLabel('Engagement', { exact: true }).selectOption({ index: 1 });
  await xpanel.getByLabel('What for').fill(spent);
  await xpanel.getByLabel('Amount (KES)').fill('1250.00');
  await xpanel.getByRole('button', { name: 'Record expense', exact: true }).click();
  await expect(page.getByText('Expense recorded.')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(spent) })).toHaveCount(1);

  // Delete lives in the row menu.
  const menuBtn = page.getByRole('row', { name: new RegExp(doing) }).getByRole('button', { name: /Actions for/ });
  await menuBtn.scrollIntoViewIfNeeded(); // the menu closes on scroll, so settle the page first
  await menuBtn.click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('row', { name: new RegExp(doing) })).toHaveCount(0);
  const menuBtn2 = page.getByRole('row', { name: new RegExp(spent) }).getByRole('button', { name: /Actions for/ });
  await menuBtn2.scrollIntoViewIfNeeded(); // the menu closes on scroll, so settle the page first
  await menuBtn2.click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('row', { name: new RegExp(spent) })).toHaveCount(0);

  // The billing pages answer "not found / not allowed" for staff.
  await page.goto('/invoices');
  await expect(page.getByText('Your role cannot do that here.')).toBeVisible();
});

test('a manager sees the billing overview, invoices as a table, and the practice warning', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await open(page, '/billing', 'Billing');
  await expect(page.getByText('Still owed to the firm')).toBeVisible();
  await expect(page.getByText('Utilisation').first()).toBeVisible();
  // The tiles come first, then the By engagement and By person tables.
  const tiles = page.getByLabel('Invoicing');
  const byEng = page.getByRole('heading', { name: 'By engagement', level: 2 });
  const byPerson = page.getByRole('heading', { name: 'By person', level: 2 });
  await expect(byEng).toBeVisible();
  await expect(byPerson).toBeVisible();
  const [t, e, p] = [await tiles.boundingBox(), await byEng.boundingBox(), await byPerson.boundingBox()];
  expect(t!.y).toBeLessThan(e!.y);
  expect(e!.y).toBeLessThan(p!.y);
  const engTable = page.getByRole('table', { name: 'By engagement' });
  await expect(engTable.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first()).toBeVisible();
  await expect(page.getByRole('table', { name: 'By person' }).getByRole('row')).not.toHaveCount(1);
  // The old row of links is gone: the tab bar is the way around, and the one main button is a new invoice.
  await expect(page.locator('main a.button:not(.secondary)')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '+ New invoice' })).toHaveAttribute('href', '/invoices/new');
  await expect(page.getByRole('link', { name: 'Sent emails' })).toHaveCount(1);
  await plain(page, 'billing overview');

  await open(page, '/invoices', 'Invoices');
  await expect(page.getByRole('navigation', { name: 'Billing sections' }).getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');
  await expect(nav(page).getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
  const table = page.getByRole('table', { name: 'Invoices' });
  await expect(table.getByRole('row', { name: /Mwangaza Traders Ltd/ }).first()).toBeVisible();
  await expect(table.getByRole('link', { name: /KA-\d{4}-\d{4}/ }).first()).toBeVisible();
  await expect(page.getByText('Savannah Farms Ltd')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '+ New invoice' })).toHaveAttribute('href', '/invoices/new');
  await expect(page.locator('main a.button:not(.secondary)')).toHaveCount(1);
  await expect(table.getByRole('row', { name: /Mwangaza Traders Ltd/ }).first()).toContainText('practice');
  await plain(page, 'invoices');

  // Chips filter by status.
  const chips = page.getByRole('group', { name: 'Filter invoices' });
  await expect(chips.getByRole('button')).toHaveText([/All/, /Drafts/, /Open/, /Overdue/, /Paid/, /Void/]);
  await expect(chips.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'true');
  await chips.getByRole('button', { name: /Overdue/ }).click();
  await expect(chips.getByRole('button', { name: /Overdue/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(table.getByRole('row', { name: /Lakeview Rentals Ltd/ }).first()).toBeVisible();
  await chips.getByRole('button', { name: /Open/ }).click();
  await expect(table.getByRole('row', { name: /Mwangaza Traders Ltd/ }).first()).toBeVisible();
  await expect(chips.getByRole('button', { name: /Open/ })).toHaveAttribute('aria-pressed', 'true');
  await chips.getByRole('button', { name: /Drafts/ }).click();
  await expect(page.getByRole('row', { name: /Lakeview Rentals Ltd/ })).toHaveCount(0);
  await expect(page.getByText('Savannah Farms Ltd')).toHaveCount(0);

  // Search narrows the rows (the header row is the one that stays).
  await chips.getByRole('button', { name: /All/ }).click();
  await expect(table.getByRole('row', { name: /Lakeview Rentals Ltd/ }).first()).toBeVisible();
  await page.getByLabel('Search invoices').fill('Mwangaza');
  await expect(table.getByRole('row', { name: /Mwangaza Traders Ltd/ }).first()).toBeVisible();
  await expect(table.getByRole('row').filter({ hasNotText: /Mwangaza/ })).toHaveCount(1);
  await page.getByLabel('Search invoices').fill('zzzz nothing');
  await expect(page.getByRole('heading', { name: 'No invoices match' })).toBeVisible();
  await page.getByRole('button', { name: 'Show everything' }).click();
  await expect(table.getByRole('row', { name: /Mwangaza Traders Ltd/ }).first()).toBeVisible();
  await page.getByLabel('Search invoices').fill('Mwangaza');

  // Clicking a row (not only its number) opens the document.
  await table.getByRole('row', { name: /Mwangaza Traders Ltd/ }).first().getByRole('cell', { name: 'Mwangaza Traders Ltd' }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/);
  await expect(page.getByText(PRACTICE)).toBeVisible();
  await expect(page.getByText('VAT 16.00%')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Issue the invoice' })).toHaveCount(0);
  await plain(page, 'invoice document');
});

test('a manager drafts an invoice from unbilled time with VAT chosen, and a partner issues, is paid and sends it', async ({ browser }) => {
  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await open(daniel, '/invoices/new', 'New invoice');
  await plain(daniel, 'new invoice');
  await daniel.getByLabel('Client', { exact: true }).selectOption({ label: 'Mwangaza Traders Ltd' });
  await daniel.getByLabel(/Engagement \(to bill/).selectOption({ index: 1 });
  await expect(daniel.getByText('Not yet invoiced on this engagement')).toBeVisible();
  await daniel.getByRole('checkbox', { name: /Bill Payables and accruals testing/ }).check();
  await daniel.getByRole('checkbox', { name: /^VAT 16\.00%/ }).first().check().catch(async () => {
    await daniel.getByText('VAT 16%').first().click();
  });
  await daniel.getByRole('button', { name: 'Save as draft' }).click();
  await expect(daniel.getByRole('heading', { name: 'Draft invoice' })).toBeVisible();
  await expect(daniel.getByText('VAT 16.00%')).toBeVisible();
  await expect(daniel.getByRole('button', { name: 'Issue the invoice' })).toHaveCount(0);
  await expect(daniel.getByText('A partner or administrator issues invoices.')).toBeVisible();
  const url = daniel.url();

  const grace = await (await browser.newContext()).newPage();
  await signIn(grace, 'grace.kangethe@kangethe.example.test');
  await grace.goto(url);
  // Issue is the one main button of a draft; the rest sits in a quiet row and the "..." menu.
  await expect(grace.getByRole('button', { name: 'Issue the invoice' })).toBeVisible();
  await expect(grace.locator(MAIN)).toHaveCount(1);
  await expect(grace.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  await expect(grace.getByRole('link', { name: 'Change the draft' })).toBeVisible();
  await grace.getByRole('button', { name: 'Issue the invoice' }).click();
  await expect(grace.getByText('Issued. The invoice now has its number')).toBeVisible();
  await expect(grace.getByRole('heading', { name: /Invoice KA-\d{4}-\d{4}/ })).toBeVisible();
  await expect(grace.getByText(PRACTICE)).toBeVisible();
  await expect(grace.getByText(/SIMULATION/i)).toHaveCount(0);
  await expect(grace.getByRole('link', { name: 'Change the draft' })).toHaveCount(0);
  await expect(grace.getByRole('button', { name: 'Change the draft' })).toHaveCount(0);

  // Record a payment from the side panel: a failure shows once and the panel stays; success closes it.
  await expect(grace.locator(MAIN)).toHaveCount(1);
  await grace.getByRole('button', { name: 'Record payment' }).click();
  const pay = grace.getByRole('dialog', { name: 'Record a payment' });
  await expect(pay).toBeVisible();
  await pay.getByLabel('Amount received (KES)').fill('0.00');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(pay.getByRole('alert')).toHaveCount(1);
  await expect(grace.locator('.notice.error')).toHaveCount(1); // the error shows once, in the panel
  await pay.getByLabel('Amount received (KES)').fill('1000.00');
  await pay.getByLabel('Reference').fill('Browser test receipt');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(grace.getByText('Payment recorded.')).toBeVisible();
  await expect(pay).toHaveCount(0);
  await expect(grace.getByRole('table', { name: 'Payments' }).getByRole('row', { name: /Browser test receipt/ })).toHaveCount(1);
  await expect(grace.getByText('Part paid').first()).toBeVisible();
  // The next opening of the panel is not prefilled with the last payment.
  await grace.getByRole('button', { name: 'Record payment' }).click();
  await expect(pay).toBeVisible();
  await expect(pay.getByLabel('Amount received (KES)')).toHaveValue('');
  await expect(pay.getByLabel('Reference')).toHaveValue('');
  await pay.getByRole('button', { name: 'Cancel' }).click();
  await expect(pay).toHaveCount(0);

  // Send from the side panel; it lands in Sent emails and says it was not actually sent.
  await grace.getByRole('button', { name: 'Send to the client' }).click();
  const send = grace.getByRole('dialog', { name: 'Send to the client' });
  await expect(send.getByRole('link', { name: 'Sent emails' })).toHaveAttribute('href', '/billing/outbox');
  await plain(grace, 'send panel');
  await send.getByLabel('Send to email address').fill('client@example.com');
  await send.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(grace.getByText(/Kept in the sent emails list/)).toBeVisible();
  await expect(send).toHaveCount(0);
  await grace.getByRole('navigation', { name: 'Billing sections' }).getByRole('link', { name: 'Sent emails' }).click();
  await expect(grace.getByRole('heading', { name: 'Sent emails', level: 1 })).toBeVisible();
  await expect(grace.getByText('Not actually sent (practice mode)').first()).toBeVisible();
  await expect(grace.getByText('client@example.com').first()).toBeVisible();
  // Open one message: its text must be plain too.
  await grace.getByRole('button', { name: /client@example.com/ }).first().click();
  await expect(grace.getByText(/Please find invoice KA-/).first()).toBeVisible();
  await plain(grace, 'sent emails with a message open');
  expect(await grace.locator('main').innerText()).not.toMatch(/simulat/i);
});

test('every tab of the billing bar can be reached with the keyboard', async ({ browser }) => {
  const grace = await (await browser.newContext()).newPage();
  await signIn(grace, 'grace.kangethe@kangethe.example.test');
  await open(grace, '/billing', 'Billing');
  const bar = grace.getByRole('navigation', { name: 'Billing sections' });
  const names = ['Overview', 'Invoices', 'Quotations', 'Sent emails', 'Settings'];
  await expect(bar.getByRole('link')).toHaveText(names);
  await expect(grace.getByText('Open prospects')).toBeVisible();
  await bar.getByRole('link', { name: names[0] }).focus();
  for (const n of names.slice(1)) {
    await grace.keyboard.press('Tab');
    await expect(bar.getByRole('link', { name: n })).toBeFocused();
  }
  await bar.getByRole('link', { name: 'Sent emails' }).focus();
  await grace.keyboard.press('Enter');
  await expect(grace).toHaveURL(/\/billing\/outbox/);
  await expect(grace.getByRole('heading', { name: 'Sent emails', level: 1 })).toBeVisible();

  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await open(daniel, '/billing', 'Billing');
  const dbar = daniel.getByRole('navigation', { name: 'Billing sections' });
  await expect(dbar.getByRole('link')).toHaveText(['Overview', 'Invoices', 'Quotations', 'Sent emails']);
});

test('the administrator sees invoicing but not hours; a manager can read but not change rates and taxes', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'wanjiru.mugo@kangethe.example.test');
  await open(admin, '/billing', 'Billing');
  await expect(admin.getByText('Still owed to the firm')).toBeVisible();
  await expect(admin.getByText('Hours logged')).toHaveCount(0);
  await expect(admin.getByRole('heading', { name: 'By engagement' })).toHaveCount(0);
  await expect(nav(admin).getByRole('link', { name: 'Timesheet' })).toHaveCount(0);
  await open(admin, '/invoices', 'Invoices');
  await expect(admin.getByRole('table', { name: 'Invoices' }).getByRole('link', { name: /KA-\d{4}-\d{4}/ }).first()).toBeVisible();

  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await open(daniel, '/billing/settings', 'Rates, taxes and settings');
  // Rates is open first; a manager can read the values but has no Save button.
  await expect(daniel.getByLabel(/^Partner/)).toBeVisible();
  await expect(daniel.getByLabel(/^Partner/)).toBeDisabled();
  await expect(daniel.getByRole('button', { name: 'Save rates' })).toHaveCount(0);
  await daniel.getByRole('button', { name: 'Taxes', exact: true }).click();
  await expect(daniel.getByRole('cell', { name: 'VAT', exact: true })).toBeVisible();
  await expect(daniel.getByRole('button', { name: 'Add tax' })).toHaveCount(0);

  const grace = await (await browser.newContext()).newPage();
  await signIn(grace, 'grace.kangethe@kangethe.example.test');
  await open(grace, '/billing/settings', 'Rates, taxes and settings');
  await expect(grace.getByRole('button', { name: 'Save rates' })).toBeVisible();
  await expect(grace.locator(MAIN)).toHaveCount(1);
  // One section open at a time, each with its own Save.
  await grace.getByRole('button', { name: 'Invoice details', exact: true }).click();
  await expect(grace.getByRole('button', { name: 'Save invoice details' })).toBeVisible();
  await expect(grace.getByRole('button', { name: 'Save rates' })).toBeHidden();
  await expect(grace.locator(MAIN)).toHaveCount(1);
  await grace.getByRole('button', { name: 'Taxes', exact: true }).click();
  await expect(grace.getByRole('button', { name: 'Add tax' })).toBeVisible();
  await plain(grace, 'settings, taxes open');
  await expect(grace.getByRole('button', { name: 'Save invoice details' })).toBeHidden();
  await grace.getByRole('button', { name: 'Hourly rates (KES)', exact: true }).click();
  await grace.getByRole('button', { name: 'Save rates' }).click();
  await expect(grace.getByText(/^Hourly rates saved\./)).toBeVisible();
  await plain(grace, 'settings, rates open');
});

test('quotations are a table for managers and partners; the fee card is on the engagement overview', async ({ browser }) => {
  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await open(daniel, '/quotes', 'Quotations');
  const table = daniel.getByRole('table', { name: 'Quotations' });
  await expect(table.getByRole('row', { name: /Mlima Coffee Cooperative/ }).first()).toBeVisible();
  await expect(daniel.getByRole('link', { name: '+ New quotation' })).toHaveAttribute('href', '/quotes/new');
  await expect(daniel.locator('main a.button:not(.secondary)')).toHaveCount(1);
  const chips = daniel.getByRole('group', { name: 'Filter quotations' });
  await expect(chips.getByRole('button')).toHaveText([/All/, /Drafts/, /Sent/, /Accepted/, /Declined/]);
  await chips.getByRole('button', { name: /Declined/ }).click();
  await expect(chips.getByRole('button', { name: /Declined/ })).toHaveAttribute('aria-pressed', 'true');
  await chips.getByRole('button', { name: /All/ }).click();
  await daniel.getByLabel('Search quotations').fill('Mlima');
  await expect(table.getByRole('row', { name: /Mlima Coffee Cooperative/ }).first()).toBeVisible();
  await expect(table.getByRole('row').filter({ hasNotText: /Mlima/ })).toHaveCount(1);
  await plain(daniel, 'quotations');
  await table.getByRole('row', { name: /Mlima Coffee Cooperative/ }).first().getByRole('cell', { name: 'Mlima Coffee Cooperative' }).click();
  await expect(daniel).toHaveURL(/\/quotes\/[0-9a-f-]{36}/);
  await expect(daniel.getByRole('heading', { level: 1, name: /Quotation|Draft quotation/ })).toBeVisible();
  await open(daniel, '/quotes/new', 'New quotation');
  await plain(daniel, 'new quotation');
  await daniel.goBack();
  await expect(daniel.getByRole('heading', { level: 1, name: /Quotation|Draft quotation/ })).toBeVisible();
  await expect(daniel.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  await plain(daniel, 'quotation document');
  await daniel.goto('/engagements');
  await daniel.waitForLoadState('networkidle');
  await daniel.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await expect(daniel).toHaveURL(/\/engagements\/[0-9a-f-]{36}/, { timeout: 90_000 });
  await expect(daniel.getByRole('heading', { name: 'How this job is billed' })).toBeVisible();

  const brian = await (await browser.newContext()).newPage();
  await signIn(brian, 'brian.kiptoo@kangethe.example.test');
  await brian.goto('/engagements');
  await brian.waitForLoadState('networkidle');
  await brian.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await expect(brian).toHaveURL(/\/engagements\/[0-9a-f-]{36}/, { timeout: 90_000 });
  await expect(brian.getByRole('heading', { name: 'Audit roadmap' })).toBeVisible();
  await expect(brian.getByRole('heading', { name: 'How this job is billed' })).toHaveCount(0);
});

// ---- Letterhead: frozen when an invoice is issued. Uses the second firm (Waweru); the main firm (Kangethe) keeps no branding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function logoPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 4 }, () => [200, 30, 30]).flat())]);
  const raw = Buffer.concat(Array.from({ length: 4 }, () => row));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
/** The text drawn on the PDF pages (pdfkit writes it as hex strings). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const hex = (x: string) => Buffer.from(x, 'hex').toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
    if (m[1] !== undefined) out.push([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hex(x[1]!)).join(''));
    else out.push(hex(m[2]!));
  }
  return out.join('\n');
}
const csrfOf = async (page: Page): Promise<string> => ((await (await page.request.get('/api/auth/csrf')).json()) as { token: string }).token;

test('the invoice keeps the letterhead it was issued with, on screen and on the PDF, when the firm changes its details later', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  const partner = await (await browser.newContext()).newPage();
  const manager = await (await browser.newContext()).newPage();
  await signIn(admin, 'peter.maina@waweru.example.test');
  await signIn(partner, 'joseph.waweru@waweru.example.test');
  await signIn(manager, 'esther.wairimu@waweru.example.test');
  const send = async (page: Page, method: 'put' | 'post' | 'delete', url: string, data?: object) => {
    const res = await page.request[method](url, { headers: { 'x-csrf-token': await csrfOf(page) }, ...(data ? { data } : {}) });
    expect(res.ok(), `${method} ${url}: ${res.status()}`).toBe(true);
    return res;
  };
  const got = (await (await partner.request.get('/api/billing/settings')).json()) as { settings?: Record<string, unknown> } & Record<string, unknown>;
  const was = (got.settings ?? got) as { legalName: string | null; address: string | null; kraPin: string | null; bankDetails: string | null; invoicePrefix: string; quotePrefix: string; paymentTermsDays: number };
  const restore = { ...(was.kraPin ? { kraPin: was.kraPin } : {}), legalName: was.legalName ?? '', address: was.address ?? '', bankDetails: was.bankDetails ?? '', invoicePrefix: was.invoicePrefix, quotePrefix: was.quotePrefix, paymentTermsDays: was.paymentTermsDays };
  try {
    await send(partner, 'put', '/api/billing/settings', { ...restore, legalName: 'Waweru Letterhead LLP', address: 'Old Mill Road 4, Nakuru', bankDetails: 'Old Bank account 777' });
    await send(admin, 'put', '/api/branding', { primary: '#1d4ed8', secondary: '#e3eee4', phone: '+254 722 000 111', email: 'hello@waweru-old.example.test', website: 'https://waweru-old.example.test', footerNote: 'Thank you from the old letterhead' });
    const up = await admin.request.post('/api/branding/logo', { headers: { 'x-csrf-token': await csrfOf(admin) }, multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: logoPng() } } });
    expect(up.ok()).toBe(true);

    const clientId = ((await (await send(manager, 'post', '/api/clients', { name: 'Letterhead Client Ltd', sector: 'trading', legalForm: 'limited_company', yearEndMonth: 12 })).json()) as { id: string }).id;
    const invoiceId = ((await (await send(manager, 'post', '/api/invoices', { clientId, taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Audit fee', quantity: '1', unitPrice: '50000.00' }] })).json()) as { id: string }).id;

    // A draft shows the letterhead as it stands; the partner then issues it from the page.
    await partner.goto(`/invoices/${invoiceId}`);
    await expect(partner.getByRole('heading', { name: 'Draft invoice' })).toBeVisible();
    await expect(partner.getByLabel('Letterhead')).toContainText('Waweru Letterhead LLP');
    await partner.getByRole('button', { name: 'Issue the invoice' }).click();
    await expect(partner.getByText('Issued. The invoice now has its number')).toBeVisible();
    const head = partner.getByLabel('Letterhead');
    await expect(head).toContainText('Waweru Letterhead LLP');
    await expect(head).toContainText('Old Mill Road 4, Nakuru');
    await expect(head).toContainText('+254 722 000 111');
    await expect(head).toContainText('hello@waweru-old.example.test');
    await expect(head).toContainText('Powered by AuditOS');
    await expect(head.locator('img')).toHaveCount(1);
    await expect(head.locator('img')).toHaveAttribute('src', /\/api\/branding\/logo\//);
    await partner.waitForLoadState('networkidle');
    expect(await head.locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await partner.screenshot({ path: process.env.TASK6_SHOT ?? 'task6-invoice.png', fullPage: true });
    await plain(partner, 'issued invoice with letterhead');

    // The PDF download carries the same letterhead.
    const pdfBefore = await (await partner.request.get(`/api/invoices/${invoiceId}/pdf`)).body();
    const t1 = pdfText(pdfBefore);
    for (const s of ['Waweru Letterhead LLP', 'Old Mill Road 4, Nakuru', 'hello@waweru-old.example.test', 'Thank you from the old letterhead', 'Old Bank account 777', 'Powered by AuditOS']) expect(t1, s).toContain(s);
    expect(pdfBefore.toString('latin1')).toContain('/Subtype /Image');

    // The firm renames itself, moves, changes colour and drops the logo.
    await send(partner, 'put', '/api/billing/settings', { ...restore, legalName: 'Completely Renamed Partners', address: 'New Tower 1, Kisumu', bankDetails: 'New Bank account 888' });
    await send(admin, 'put', '/api/branding', { primary: '#7a1f1f', secondary: '#e3eee4', phone: '+254 733 999 888', email: 'hello@waweru-new.example.test', website: 'https://waweru-new.example.test', footerNote: 'Thank you from the new letterhead' });
    await send(admin, 'delete', '/api/branding/logo');

    await partner.reload();
    const head2 = partner.getByLabel('Letterhead');
    await expect(head2).toContainText('Waweru Letterhead LLP');
    await expect(head2).toContainText('Old Mill Road 4, Nakuru');
    await expect(head2).not.toContainText('Completely Renamed');
    await expect(head2).toContainText('Powered by AuditOS');
    await expect(head2.locator('img')).toHaveCount(1);
    const pdfAfter = await (await partner.request.get(`/api/invoices/${invoiceId}/pdf`)).body();
    const t2 = pdfText(pdfAfter);
    expect(t2).toContain('Waweru Letterhead LLP');
    expect(t2).toContain('Thank you from the old letterhead');
    expect(t2).not.toContain('Completely Renamed');
    expect(t2).not.toContain('new letterhead');
    expect(pdfAfter.toString('latin1')).toContain('/Subtype /Image');

    // A new draft takes the new letterhead.
    const draftId = ((await (await send(manager, 'post', '/api/invoices', { clientId, taxMode: 'exclusive', taxIds: [], lines: [{ description: 'Second job', quantity: '1', unitPrice: '1000.00' }] })).json()) as { id: string }).id;
    await partner.goto(`/invoices/${draftId}`);
    await expect(partner.getByLabel('Letterhead')).toContainText('Completely Renamed Partners');
    await expect(partner.getByLabel('Letterhead').locator('img')).toHaveCount(0);
    await send(manager, 'delete', `/api/invoices/${draftId}`);
  } finally {
    await admin.request.delete('/api/branding/logo', { headers: { 'x-csrf-token': await csrfOf(admin) } });
    const r1 = await admin.request.put('/api/branding', { headers: { 'x-csrf-token': await csrfOf(admin) }, data: { primary: '#2e6b4c', secondary: '#e3eee4', phone: '', email: '', website: '', footerNote: '' } });
    expect(r1.ok()).toBe(true);
    const r2 = await partner.request.put('/api/billing/settings', { headers: { 'x-csrf-token': await csrfOf(partner) }, data: restore });
    expect(r2.ok(), await r2.text()).toBe(true);
  }
});
