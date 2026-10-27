import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../helpers';

const SLOW = { timeout: 90_000 };

async function openMwangaza(page: Page, tab: string) {
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await page.getByRole('tab', { name: tab }).click({ timeout: 90_000 });
  await page.waitForLoadState('networkidle');
}

const STATEMENT = (skipChargesLine: boolean) =>
  [
    'Date,Description,Debit,Credit,Balance',
    ',Balance brought forward,,,"100,000.00"',
    '02/03/2026,"ATM WITHDRAWAL WESTLANDS","5,000.00",,"95,000.00"',
    '03/03/2026,"SALARY MARCH",,"150,000.00","245,000.00"',
    '10/03/2026,"MPESA PAYBILL 247247 KPLC","3,450.50",,"241,549.50"',
    ...(skipChargesLine ? [] : ['31/03/2026,"BANK CHARGES","1,200.00",,"240,349.50"']),
    ',Closing balance,,,"240,349.50"',
  ].join('\n');

test('a manager reads the seeded bank statement, analyses it, and sees what to look at', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await openMwangaza(page, 'Bank statements');

  const row = page.getByRole('row', { name: /demo-bank-statement-march/ });
  await expect(row).toBeVisible(SLOW);
  await expect(row.getByText('Adds up')).toBeVisible();
  await row.getByRole('button', { name: 'Open' }).click();

  await page.getByLabel('Bank balance in the books (KES), to reconcile to').fill('170,000.00');
  await page.getByLabel('Related party names, separated by commas').fill('Kiprop Hardware');
  await page.getByRole('button', { name: 'Analyse' }).click();

  await expect(page.getByText('Things to look at')).toBeVisible();
  await expect(page.getByText(/repeat another with the same date, description and amount/)).toBeVisible();
  await expect(page.getByText(/looks? like a returned or dishonoured item/)).toBeVisible();
  await expect(page.getByText(/mentions? a name on the related party list \(Kiprop Hardware\)/)).toBeVisible();
  await expect(page.getByText(/a difference of 5,349.50 to explain/)).toBeVisible();
  await expect(page.getByText('Goes with: Going concern checklist')).toBeVisible();
});

test('a statement that does not add up is flagged, and confirming it needs a reason', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await openMwangaza(page, 'Bank statements');

  await page.getByLabel('Statement file').setInputFiles({ name: 'april-missing-page.csv', mimeType: 'text/csv', buffer: Buffer.from(STATEMENT(true)) });
  await page.getByRole('button', { name: 'Read statement' }).click();

  await expect(page.getByRole('heading', { name: 'Check what was read' })).toBeVisible(SLOW);
  await expect(page.getByText(/does not add up.*a difference of KES 1200.00/)).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirm with reason' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('To confirm anyway, say why (kept on the record)').fill('Client to resend the last page');
  await confirm.click();
  await expect(page.getByText('Reason: Client to resend the last page')).toBeVisible();
});

test('a file that cannot be read says why, and a discarded upload goes away', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await openMwangaza(page, 'Bank statements');

  await page.getByLabel('Statement file').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf') });
  await page.getByRole('button', { name: 'Read statement' }).click();
  await expect(page.locator('.notice.error')).toContainText(/not a PDF/i, SLOW);

  await page.getByLabel('Statement file').setInputFiles({ name: 'discard-me.csv', mimeType: 'text/csv', buffer: Buffer.from(STATEMENT(false)) });
  await page.getByRole('button', { name: 'Read statement' }).click();
  await expect(page.getByRole('heading', { name: 'Check what was read' })).toBeVisible(SLOW);
  await expect(page.getByText('Every entry was read and the balances agree.')).toBeVisible();
  await page.getByRole('button', { name: 'Discard and upload again' }).click();
  await expect(page.getByRole('heading', { name: 'Check what was read' })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /discard-me/ })).toHaveCount(0);
});

test('a partner who is not on the team can read the statements but not upload', async ({ page }) => {
  await signIn(page, 'charles.kamau@kangethe.example.test');
  await openMwangaza(page, 'Bank statements');
  await expect(page.getByRole('row', { name: /demo-bank-statement-march/ })).toBeVisible(SLOW);
  await expect(page.getByRole('heading', { name: 'Upload a bank statement' })).toHaveCount(0);
});

test('a sampling schedule shows its progress, takes a result, and a new sample can be drawn from a file', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await openMwangaza(page, 'Sampling');

  const row = page.getByRole('row', { name: /Trade payables at year end/ });
  await expect(row).toBeVisible(SLOW);
  await row.getByRole('button', { name: 'Open' }).click();
  const schedule = page.getByRole('region', { name: 'Schedule Trade payables at year end' });
  await expect(schedule.getByText('3 of 8')).toBeVisible();
  await expect(schedule.getByText(/1 exception/)).toBeVisible();
  await expect(schedule.getByText(/not a conclusion/i)).toBeVisible();

  await schedule.getByRole('button', { name: 'Record result' }).first().click();
  await schedule.getByRole('button', { name: 'Save result' }).click();
  await expect(schedule.getByText('4 of 8')).toBeVisible();

  const pop = ['Invoice,Description,Amount', ...Array.from({ length: 30 }, (_, i) => `SI-${i + 1},Customer ${i + 1},${(2000 + i * 100).toFixed(2)}`)].join('\n');
  await page.getByLabel('What is being tested').fill('Revenue invoices');
  await page.getByLabel('How many items').fill('5');
  await page.getByLabel('Seed (leave blank to make one)').fill('browser-test');
  await page.getByLabel('Population file').setInputFiles({ name: 'sales.csv', mimeType: 'text/csv', buffer: Buffer.from(pop) });
  await page.getByRole('button', { name: 'Draw sample' }).click();
  const drawn = page.getByRole('region', { name: 'Schedule Revenue invoices' });
  await expect(drawn).toBeVisible(SLOW);
  await expect(drawn.getByText('browser-test')).toBeVisible();
  await expect(drawn.getByText('0 of 5')).toBeVisible();
});

test('a population with an unreadable amount is refused, with the row', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await openMwangaza(page, 'Sampling');
  await page.getByLabel('What is being tested').fill('Bad file');
  await page.getByLabel('Population file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('Invoice,Amount\nA-1,100.00\nA-2,not money') });
  await page.getByRole('button', { name: 'Draw sample' }).click();
  await expect(page.getByText(/Row 3: The amount "not money" could not be read/)).toBeVisible(SLOW);
});
