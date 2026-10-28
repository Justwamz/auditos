import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
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
  await page.getByLabel('Engagement', { exact: true }).first().selectOption({ index: 1 });
  await page.getByLabel('Time (hours)').fill('1:30');
  await page.getByLabel('What you did').fill('Browser test: attendance at the stock count');
  await page.getByRole('button', { name: 'Log time' }).click();
  await expect(page.getByText('Logged 1h 30m.')).toBeVisible();
  await expect(page.getByText('Browser test: attendance at the stock count')).toBeVisible();
  await expect(page.getByText(/KES [\d,]+\.\d\d/)).toHaveCount(0);

  // The billing pages answer "not found / not allowed" for staff.
  await page.goto('/invoices');
  await expect(page.getByText('Your role cannot do that here.')).toBeVisible();
});

test('a manager sees the billing summary, the invoices of their engagements, and the simulation warning', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await open(page, '/billing', 'Billing');
  await expect(page.getByText('Still owed to the firm')).toBeVisible();
  await expect(page.getByText('Utilisation').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first()).toBeVisible();

  await open(page, '/invoices', 'Invoices');
  await expect(page.getByRole('navigation', { name: 'Billing sections' }).getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');
  await expect(nav(page).getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: /KA-\d{4}-\d{4}/ }).first()).toBeVisible();
  await expect(page.getByText('Savannah Farms Ltd')).toHaveCount(0);
  await page.getByLabel('Show').selectOption('overdue');
  await expect(page.getByText('Lakeview Rentals Ltd')).toBeVisible();

  await page.getByLabel('Show').selectOption('open');
  await page.getByRole('row', { name: /Mwangaza Traders Ltd/ }).getByRole('link').click();
  await expect(page.getByText('SIMULATION: this invoice has not been submitted to KRA')).toBeVisible();
  await expect(page.getByText('VAT 16.00%')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Issue the invoice' })).toHaveCount(0);
});

test('a manager drafts an invoice from unbilled time with VAT chosen, and a partner issues it', async ({ browser }) => {
  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await open(daniel, '/invoices/new', 'New invoice');
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
  await grace.getByRole('button', { name: 'Issue the invoice' }).click();
  await expect(grace.getByText('Issued. The invoice now has its number')).toBeVisible();
  await expect(grace.getByRole('heading', { name: /Invoice KA-\d{4}-\d{4}/ })).toBeVisible();
  await expect(grace.getByText('SIMULATION: this invoice has not been submitted to KRA')).toBeVisible();
  await expect(grace.getByRole('button', { name: 'Change the draft' })).toHaveCount(0);
});

test('the administrator sees invoicing but not hours; a manager can read but not change rates and taxes', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'wanjiru.mugo@kangethe.example.test');
  await open(admin, '/billing', 'Billing');
  await expect(admin.getByText('Still owed to the firm')).toBeVisible();
  await expect(admin.getByText('Hours logged')).toHaveCount(0);
  await expect(nav(admin).getByRole('link', { name: 'Timesheet' })).toHaveCount(0);

  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await open(daniel, '/billing/settings', 'Rates, taxes and settings');
  await expect(daniel.getByRole('cell', { name: 'VAT', exact: true })).toBeVisible();
  await expect(daniel.getByRole('button', { name: 'Save rates' })).toHaveCount(0);

  const grace = await (await browser.newContext()).newPage();
  await signIn(grace, 'grace.kangethe@kangethe.example.test');
  await open(grace, '/billing/settings', 'Rates, taxes and settings');
  await expect(grace.getByRole('button', { name: 'Save rates' })).toBeVisible();
});

test('quotations are for managers and partners; the fee card is on the engagement overview', async ({ browser }) => {
  const daniel = await (await browser.newContext()).newPage();
  await signIn(daniel, 'daniel.otieno@kangethe.example.test');
  await open(daniel, '/quotes', 'Quotations');
  await expect(daniel.getByText('Mlima Coffee Cooperative')).toBeVisible();
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
