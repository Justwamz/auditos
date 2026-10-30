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
