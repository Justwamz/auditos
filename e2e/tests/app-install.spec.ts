import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, PHONE, openMenu, signIn } from '../helpers';

const grace = 'grace.kangethe@kangethe.example.test';
const ICONS = ['auditos-32', 'auditos-180', 'auditos-192', 'auditos-512', 'auditos-maskable'];

async function workerReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 }).catch(async () => {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  });
}

async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    e.prompt = () => Promise.resolve();
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  });
}

test('signed out: the manifest, icons, worker and offline page are reachable', async ({ request, page }) => {
  const m = await request.get('/site.webmanifest');
  expect(m.status()).toBe(200);
  expect((await m.json()).name).toBe('AuditOS');
  for (const i of ICONS) {
    const r = await request.get(`/icons/${i}.png`);
    expect(r.status(), i).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  const svg = await request.get('/icons/auditos.svg');
  expect(svg.status()).toBe(200);
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(sw.headers()['content-type']).toContain('javascript');
  expect(sw.headers()['cache-control']).toContain('no-store');
  const off = await request.get('/offline');
  expect(off.status()).toBe(200);
  expect(await off.text()).toMatch(/You(&#x27;|')re offline/);

  await page.goto('/login');
  const link = page.locator('link[rel=manifest]');
  await expect(link).toHaveAttribute('crossorigin', 'use-credentials');
  await expect(link).toHaveAttribute('href', '/site.webmanifest');
  await expect(page.locator('link[rel=icon]').first()).toHaveAttribute('href', '/icons/auditos-32.png');
  await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', '#2e6b4c');
});

test('signed out: nothing else is public', async ({ request }) => {
  for (const p of ['/clients', '/', '/engagements', '/icons/x/y', '/sw.js/x', '/swXjs']) {
    const r = await request.get(p, { maxRedirects: 0 });
    expect(r.status(), p).toBe(307);
  }
  expect((await request.get('/api/me')).status()).toBe(401);
});

test('offline after signing in shows the offline page and nothing private is kept', async ({ page, context }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, grace);
  await workerReady(page);
  for (const p of ['/', '/clients', '/engagements', '/billing']) await page.goto(p);
  const urls = await page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(urls.length).toBeGreaterThan(0);
  for (const u of urls) {
    expect(u).toMatch(/^\/(offline|icons\/[\w.-]+|_next\/static\/(?!webpack\/).+)$/);
    expect(u.startsWith('/api/')).toBe(false);
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await context.setOffline(true);
  await page.goto('/clients').catch(() => undefined);
  await expect(page.getByText("You're offline")).toBeVisible();
  await expect(page.getByText('Mwangaza')).toHaveCount(0);
  await context.setOffline(false);
});

test("an older version's cache is removed when the worker starts", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Seed from a same-origin page that does not register the worker, so the worker cannot start first.
  await page.goto('/icons/auditos.svg');
  await page.evaluate(async () => {
    const c = await caches.open('aos-shell-v0');
    await c.put('/old', new Response('old'));
  });
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(async () => !(await caches.keys()).includes('aos-shell-v0'));
  expect(await page.evaluate(() => caches.keys())).not.toContain('aos-shell-v0');
  await context.close();
});

test('Install AuditOS shows only when the browser offers it, and Not now is remembered', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, grace);
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Install AuditOS' });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(button).toHaveCount(0);
  await offerInstall(page);
  await expect(button).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(button).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await offerInstall(page);
  await expect(button).toHaveCount(0);

  await page.evaluate(() => localStorage.removeItem('aos-install-dismissed'));
  await page.setViewportSize(PHONE);
  await page.reload();
  await offerInstall(page);
  const dialog = await openMenu(page);
  await expect(dialog.getByRole('button', { name: 'Install AuditOS' })).toBeVisible();
});

test('no install button on the sign-in page', async ({ page }) => {
  await page.goto('/login');
  await offerInstall(page);
  await expect(page.getByRole('button', { name: /Install/ })).toHaveCount(0);
});

// The firm with a logo is Waweru (Kangethe stays plain AuditOS for every other spec). The logo is removed at the end.
const waweruAdmin = 'peter.maina@waweru.example.test';
const waweruStaff = 'lucy.chebet@waweru.example.test';

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
/** A real 200 x 80 blue PNG, built here so the test needs no image file. */
function logoPng(): Buffer {
  const w = 200;
  const h = 80;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [20, 60, 200]).flat())]);
  const rows = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('a firm with a logo gets it as the tab icon and app icon; signed out gets AuditOS', async ({ browser, page }) => {
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  const csrf = async () => ((await (await adminPage.request.get('/api/auth/csrf')).json()) as { token: string }).token;
  try {
    await signIn(adminPage, waweruAdmin);
    const up = await adminPage.request.post('/api/branding/logo', { headers: { 'x-csrf-token': await csrf() }, multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: logoPng() } } });
    expect(up.status()).toBe(200);
    const { logoId } = (await up.json()) as { logoId: string };

    await signIn(page, waweruStaff);
    await page.goto('/');
    const icon = page.locator('link[rel=icon]').first();
    await expect(icon).toHaveAttribute('href', `/api/branding/icon/${logoId}/32`);
    const img = await page.request.get(`/api/branding/icon/${logoId}/32`);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toBe('image/png');
    expect(img.headers()['cache-control']).toContain('private');
    const png = await img.body();
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', `/api/branding/icon/${logoId}/180`);

    const signedIn = await (await page.request.get('/site.webmanifest')).json();
    expect(signedIn.name).toBe('Waweru & Associates');
    expect(signedIn.icons.map((i: { src: string }) => i.src)).toEqual([`/api/branding/icon/${logoId}/192`, `/api/branding/icon/${logoId}/512`, `/api/branding/icon/${logoId}/maskable`]);

    // The worker never keeps these pictures.
    await workerReady(page);
    await page.goto('/');
    const kept = await page.evaluate(async () => {
      const out: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
      return out;
    });
    expect(kept.some((u) => u.startsWith('/api/'))).toBe(false);

    // Signed out: the sign-in page and the app description are plain AuditOS, and the firm's picture is not given out.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('link[rel=icon]').first()).toHaveAttribute('href', '/icons/auditos-32.png');
    const signedOut = await (await page.request.get('/site.webmanifest')).json();
    expect(signedOut.name).toBe('AuditOS');
    expect(signedOut.icons[0].src).toBe('/icons/auditos-192.png');
    const anon = await browser.newContext();
    expect((await anon.request.get(`/api/branding/icon/${logoId}/512`)).status()).toBe(401);
    expect(((await (await anon.request.get('/site.webmanifest')).json()) as { name: string }).name).toBe('AuditOS');
    await anon.close();

    // Take the logo away: the next visit shows the AuditOS icon again.
    expect((await adminPage.request.delete('/api/branding/logo', { headers: { 'x-csrf-token': await csrf() } })).ok()).toBe(true);
    await signIn(page, waweruStaff);
    await page.goto('/');
    await expect(page.locator('link[rel=icon]').first()).toHaveAttribute('href', '/icons/auditos-32.png');
  } finally {
    await adminPage.request.delete('/api/branding/logo', { headers: { 'x-csrf-token': await csrf() } }).catch(() => undefined);
    await adminCtx.close();
  }
});
