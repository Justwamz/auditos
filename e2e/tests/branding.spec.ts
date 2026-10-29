import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { BANNED, signIn } from '../helpers';

// Branding is saved on the second firm (Waweru) only. A saved branding row cannot be removed again, and the
// main firm (Kangethe) other specs use must keep the plain AuditOS look, so nothing here touches Kangethe.
const admin = 'peter.maina@waweru.example.test';
const others = [
  { who: 'partner', email: 'joseph.waweru@waweru.example.test' },
  { who: 'manager', email: 'esther.wairimu@waweru.example.test' },
  { who: 'staff', email: 'lucy.chebet@waweru.example.test' },
];
const DEFAULTS = { primary: '#2e6b4c', secondary: '#e3eee4' };

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
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A real 4 x 4 red PNG, built here so the test needs no image file. */
function tinyPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 4 }, () => [200, 30, 30]).flat())]);
  const raw = Buffer.concat(Array.from({ length: 4 }, () => row));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const MAIN = 'main button:visible:not(.secondary):not(.quiet):not(.danger)';

async function csrf(page: Page): Promise<string> {
  return ((await (await page.request.get('/api/auth/csrf')).json()) as { token: string }).token;
}

async function openBranding(page: Page) {
  await page.goto('/admin/users');
  await page.getByRole('navigation', { name: 'Firm sections' }).getByRole('link', { name: 'Branding' }).click();
  await expect(page.getByRole('heading', { name: 'Branding', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Main colour code')).not.toHaveValue('');
}

async function pickFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByLabel('Logo file (PNG or JPG)').setInputFiles({ name, mimeType, buffer });
  await page.getByRole('button', { name: /^(Upload|Replace) logo$/ }).click();
}

test.describe('branding page', () => {
  test('the administrator saves colours, contact details and a logo, and they are still there after a reload', async ({ page }) => {
    await signIn(page, admin);
    try {
      await openBranding(page);
      await expect(page.locator(MAIN)).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Save branding' })).toBeVisible();

      // The four existing details are read only and point to Billing settings.
      const link = page.getByRole('link', { name: 'Change these in Billing settings' });
      await expect(link).toHaveAttribute('href', '/billing/settings');
      await expect(page.getByText('Firm name on invoices')).toBeVisible();

      await pickFile(page, 'logo.png', 'image/png', tinyPng());
      await expect(page.getByAltText('Your firm logo')).toBeVisible();
      await expect(page.locator('.notice.error')).toHaveCount(0);

      await page.getByLabel('Main colour code').fill('#1d4ed8');
      await page.getByLabel('Accent colour code').fill('#e0e7ff');
      await page.getByLabel('Phone').fill('+254 700 123 456');
      await page.getByLabel('Email').fill('hello@waweru.example.test');
      await page.getByLabel('Website').fill('https://waweru.example.test');
      await page.getByLabel('Footer note').fill('Payable within 30 days.');
      // The colour picker and the colour code box stay in step.
      await expect(page.getByLabel('Main colour picker')).toHaveValue('#1d4ed8');
      await page.getByRole('button', { name: 'Save branding' }).click();
      await expect(page.getByText('Branding saved.')).toBeVisible();

      await page.reload();
      await expect(page.getByLabel('Main colour code')).toHaveValue('#1d4ed8');
      await expect(page.getByLabel('Accent colour code')).toHaveValue('#e0e7ff');
      await expect(page.getByLabel('Phone')).toHaveValue('+254 700 123 456');
      await expect(page.getByLabel('Email')).toHaveValue('hello@waweru.example.test');
      await expect(page.getByLabel('Website')).toHaveValue('https://waweru.example.test');
      await expect(page.getByLabel('Footer note')).toHaveValue('Payable within 30 days.');
      await expect(page.getByAltText('Your firm logo')).toBeVisible();
      // The logo really is served (not a broken picture).
      expect(await page.getByAltText('Your firm logo').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

      // The preview follows the picks live.
      const preview = page.getByTestId('brand-preview');
      await page.getByLabel('Main colour code').fill('#b45309');
      await expect(preview).toHaveCSS('--ledger', '#b45309');
      await expect(preview.getByText('Waweru & Associates').first()).toBeVisible();

      // Remove the logo.
      await page.getByRole('button', { name: 'Remove logo' }).click();
      await expect(page.getByAltText('Your firm logo')).toHaveCount(0);

      // The page text is plain.
      const text = await page.locator('main').innerText();
      for (const re of BANNED) expect(text, `${re}`).not.toMatch(re);
      expect(text).not.toMatch(/\bhex\b|\bcss\b/i);
    } finally {
      const token = await csrf(page);
      await page.request.delete('/api/branding/logo', { headers: { 'x-csrf-token': token } });
      const res = await page.request.put('/api/branding', {
        headers: { 'x-csrf-token': token },
        data: { ...DEFAULTS, phone: '', email: '', website: '', footerNote: '' },
      });
      expect(res.ok()).toBe(true);
    }
  });

  test('a pale yellow pick says what changed, live and after saving; Reset goes back to the AuditOS colours', async ({ page }) => {
    await signIn(page, admin);
    try {
      await openBranding(page);
      await page.getByLabel('Main colour code').fill('#fde047');
      const note = page.getByTestId('colour-note');
      await expect(note).toContainText('a little darker');
      await expect(note).toContainText('Before');
      await expect(note).toContainText('#fde047');
      await expect(note).toContainText('After');

      await page.getByRole('button', { name: 'Save branding' }).click();
      await expect(page.getByText('Branding saved.')).toBeVisible();
      await expect(note).toContainText('a little darker');
      const saved = await page.getByLabel('Main colour code').inputValue();
      expect(saved).toMatch(/^#[0-9a-f]{6}$/);
      expect(saved).not.toBe('#fde047');
      // The menu takes the saved colour straight away, with no reload.
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ledger').trim())).toBe(saved);
      await expect.poll(() => page.locator('.rail').evaluate((el) => getComputedStyle(el).backgroundImage)).not.toContain('rgb(35, 86, 64)');
      // What is saved is what the menu now uses.
      await page.reload();
      await expect(page.getByLabel('Main colour code')).toHaveValue(saved);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ledger').trim())).toBe(saved);

      await page.getByRole('button', { name: 'Reset to AuditOS colours' }).click();
      await expect(page.getByText('Back to the AuditOS colours.')).toBeVisible();
      await expect(page.getByLabel('Main colour code')).toHaveValue(DEFAULTS.primary);
      await expect(page.getByLabel('Accent colour code')).toHaveValue(DEFAULTS.secondary);
      await page.reload();
      await expect(page.getByLabel('Main colour code')).toHaveValue(DEFAULTS.primary);
      await expect(page.getByTestId('colour-note')).toHaveCount(0);
    } finally {
      const res = await page.request.put('/api/branding', { headers: { 'x-csrf-token': await csrf(page) }, data: DEFAULTS });
      expect(res.ok()).toBe(true);
    }
  });

  test('a red main colour alone leaves no green wash: the accent follows it, until an accent is picked', async ({ page }) => {
    await signIn(page, admin);
    const wash = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-wash').trim());
    try {
      await openBranding(page);
      await page.getByLabel('Main colour code').fill('#cc0000');
      await expect(page.getByTestId('secondary-note')).toHaveText('Using a light shade of your main colour until you pick your own.');
      await expect(page.getByLabel('Accent colour code')).not.toHaveValue(DEFAULTS.secondary);
      await expect(page.getByTestId('brand-preview')).not.toHaveCSS('--accent-wash', DEFAULTS.secondary);
      await page.getByRole('button', { name: 'Save branding' }).click();
      await expect(page.getByText('Branding saved.')).toBeVisible();
      await page.reload();
      await expect(page.getByLabel('Main colour code')).toHaveValue('#cc0000');
      await expect(page.getByTestId('secondary-note')).toBeVisible();
      const w = await wash();
      expect(w).toMatch(/^#[0-9a-f]{6}$/);
      expect(w).not.toBe(DEFAULTS.secondary);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(w.slice(i, i + 2), 16)) as [number, number, number];
      expect(r).toBeGreaterThan(g); // a pale red, not a pale green
      expect(r).toBeGreaterThan(b);
      // Picking an accent turns the note off and is kept.
      await page.getByLabel('Accent colour code').fill('#e0e7ff');
      await expect(page.getByTestId('secondary-note')).toHaveCount(0);
    } finally {
      const token = await csrf(page);
      const res = await page.request.put('/api/branding', { headers: { 'x-csrf-token': token }, data: { ...DEFAULTS, phone: '', email: '', website: '', footerNote: '' } });
      expect(res.ok()).toBe(true);
    }
  });

  test('rejected logos get a plain message, shown once', async ({ page }) => {
    await signIn(page, admin);
    await openBranding(page);
    const error = page.locator('.notice.error');

    await pickFile(page, 'logo.png', 'image/png', Buffer.from('this is only text'));
    await expect(error).toHaveCount(1);
    await expect(error).toHaveText('That file is not a PNG or JPG picture.');

    await pickFile(page, 'logo.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'));
    await expect(error).toHaveCount(1);
    await expect(error).toHaveText('That file is not a PNG or JPG picture.');

    const big = Buffer.concat([tinyPng().subarray(0, 40), Buffer.alloc(1_200_000)]);
    await pickFile(page, 'big.png', 'image/png', big);
    await expect(error).toHaveCount(1);
    await expect(error).toHaveText('Logos can be at most 1 MB.');
    await expect(page.getByAltText('Your firm logo')).toHaveCount(0);
  });

  test('typed but unsaved details survive a logo upload, and nothing is saved until Save is pressed', async ({ page }) => {
    await signIn(page, admin);
    try {
      await openBranding(page);
      await page.getByLabel('Phone').fill('+254 711 000 111');
      await page.getByLabel('Footer note').fill('Typed but not saved');
      await page.getByLabel('Main colour code').fill('#1d4ed8');
      await pickFile(page, 'logo.png', 'image/png', tinyPng());
      await expect(page.getByAltText('Your firm logo')).toBeVisible();
      await expect(page.getByLabel('Phone')).toHaveValue('+254 711 000 111');
      await expect(page.getByLabel('Footer note')).toHaveValue('Typed but not saved');
      await expect(page.getByLabel('Main colour code')).toHaveValue('#1d4ed8');
      // Removing the logo and resetting colours keep the typed contact details too.
      await page.getByRole('button', { name: 'Remove logo' }).click();
      await expect(page.getByAltText('Your firm logo')).toHaveCount(0);
      await page.getByRole('button', { name: 'Reset to AuditOS colours' }).click();
      await expect(page.getByText('Back to the AuditOS colours.')).toBeVisible();
      await expect(page.getByLabel('Main colour code')).toHaveValue(DEFAULTS.primary);
      await expect(page.getByLabel('Phone')).toHaveValue('+254 711 000 111');
      await expect(page.getByLabel('Footer note')).toHaveValue('Typed but not saved');
      // Nothing typed was saved.
      const saved = (await (await page.request.get('/api/branding')).json()) as { branding: { phone: string | null; footerNote: string | null } };
      expect(saved.branding.phone ?? '').toBe('');
      expect(saved.branding.footerNote ?? '').toBe('');
    } finally {
      const token = await csrf(page);
      await page.request.delete('/api/branding/logo', { headers: { 'x-csrf-token': token } });
      await page.request.put('/api/branding', { headers: { 'x-csrf-token': token }, data: { ...DEFAULTS, phone: '', email: '', website: '', footerNote: '' } });
    }
  });

  test('a colour code that is not complete keeps Save off, says why in plain words and does not break the page', async ({ page }) => {
    await signIn(page, admin);
    await openBranding(page);
    for (const bad of ['red', '#12']) {
      const code = page.getByLabel('Main colour code');
      await code.fill(bad);
      await expect(page.getByText('Colour codes look like #1a2b3c.')).toBeVisible();
      await expect(code).toHaveAttribute('aria-describedby', 'primary-hint');
      await expect(page.locator('#primary-hint')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save branding' })).toBeDisabled();
      await expect(page.getByText('Fix the colour code above to save.')).toBeVisible();
      await expect(page.getByText('Fix the colour code to see the preview.')).toBeVisible();
      await expect(page.getByTestId('brand-preview')).toHaveCount(0);
    }
    await page.getByLabel('Main colour code').fill('#1d4ed8');
    await expect(page.getByRole('button', { name: 'Save branding' })).toBeEnabled();
    await expect(page.getByTestId('brand-preview')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Branding', level: 1 })).toBeVisible();
  });

  test('everyone in the firm can read branding, only the administrator can change it; firm details are blank for staff', async ({ page }) => {
    for (const p of others) {
      await signIn(page, p.email);
      const res = await page.request.get('/api/branding');
      expect(res.status(), p.who).toBe(200);
      const body = (await res.json()) as { branding: { firm: Record<string, string | null> }; canEdit: boolean };
      expect(body.canEdit, p.who).toBe(false);
      if (p.who === 'staff') expect(Object.values(body.branding.firm), 'staff firm details').toEqual([null, null, null, null]);
    }
  });

  for (const p of others) {
    test(`a ${p.who} cannot see, open or call branding`, async ({ page }) => {
      await signIn(page, p.email);
      await expect(page.getByRole('link', { name: 'Branding' })).toHaveCount(0);
      await page.goto('/clients');
      await expect(page.getByRole('link', { name: 'Branding' })).toHaveCount(0);
      await page.goto('/branding');
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: 'Branding' })).toHaveCount(0);

      const headers = { 'x-csrf-token': await csrf(page) };
      expect((await page.request.put('/api/branding', { headers, data: DEFAULTS })).status()).toBe(403);
      expect((await page.request.post('/api/branding/logo', { headers, multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: tinyPng() } } })).status()).toBe(403);
      expect((await page.request.delete('/api/branding/logo', { headers })).status()).toBe(403);
    });
  }
});
