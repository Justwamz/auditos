import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { CREDS } from './global-setup';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = (s: string): Buffer => {
  let bits = 0, v = 0;
  const out: number[] = [];
  for (const ch of s) {
    v = (v << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};
const totp = (secret: string, step: number): string => {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(step));
  const m = createHmac('sha1', b32(secret)).update(c).digest();
  const o = m[m.length - 1]! & 15;
  return String((((m[o]! & 127) << 24) | (m[o + 1]! << 16) | (m[o + 2]! << 8) | m[o + 3]!) % 1e6).padStart(6, '0');
};

interface Creds { password: string; users: { email: string; totpSecret: string }[] }
const creds = (): Creds => JSON.parse(readFileSync(CREDS, 'utf8')) as Creds;

export const user = (email: string) => {
  const c = creds();
  const u = c.users.find((x) => x.email === email);
  if (!u) throw new Error(`no seeded user ${email}`);
  return { ...u, password: c.password };
};

const lastStep = new Map<string, number>();

/** A code for a TOTP step newer than any this helper has used for the user (the server rejects replays). */
export async function freshCode(email: string): Promise<string> {
  const u = user(email);
  const used = lastStep.get(email) ?? -1;
  let step = Math.floor(Date.now() / 30000);
  while (step <= used) {
    await new Promise((r) => setTimeout(r, 1000));
    step = Math.floor(Date.now() / 30000);
  }
  lastStep.set(email, step);
  return totp(u.totpSecret, step);
}

export async function signIn(page: Page, email: string): Promise<void> {
  const u = user(email);
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', u.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('#code');
  await page.fill('#code', await freshCode(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/[/](clients)?$/);
}

/** Answers the step-up prompt that appears before a sensitive action (if the server asks for one). */
export async function confirmStepUp(page: Page, email: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  // A step-up from the last five minutes is still valid, so the prompt may legitimately not appear.
  const shown = await dialog.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
  if (!shown) return;
  await dialog.locator('#stepup-code').fill(await freshCode(email));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toBeHidden();
}

export async function openDemoPaper(page: Page, title: string): Promise<void> {
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  await page.getByRole('tab', { name: 'Working papers' }).click();
  const row = page.getByRole('row', { name: new RegExp(title) });
  await row.getByRole('button', { name: /^Open$/ }).click();
  await expect(page.getByRole('heading', { name: title, level: 3 })).toBeVisible();
}

/** Words that sound like software; nothing a person reads may contain them. Mirrors apps/web/lib/plain.ts. */
export const BANNED: RegExp[] = [
  /authenticator/i,
  /outbox/i,
  /simulat\w*/i,
  /session/i,
  /csrf/i,
  /malware/i,
  /quarantin\w*/i,
  /fingerprint/i,
  /sha-?256/i,
  /tenant/i,
  /token/i,
  /payload/i,
  /\bapi\b/i,
  /\bmfa\b/i,
  /\btotp\b/i,
];

export const PHONE = { width: 375, height: 812 };
export const PHONE_LARGE = { width: 390, height: 844 };
export const TABLET = { width: 768, height: 1024 };
export const DESKTOP = { width: 1280, height: 800 };

/** Fails when the page is wider than the screen, naming the elements that stick out. */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const wide = root.scrollWidth > root.clientWidth;
    const culprits: string[] = [];
    if (wide) {
      const clipped = (el: Element): boolean => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (/^(auto|scroll|hidden)$/.test(getComputedStyle(p).overflowX)) return true;
        }
        return false;
      };
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (culprits.length >= 5) break;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= root.clientWidth + 0.5 || clipped(el)) continue;
        culprits.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(/\s+/).join('.')} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
      }
    }
    return { wide, culprits, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(result.wide, `${label}: page is ${result.scrollWidth}px wide in a ${result.clientWidth}px screen; sticking out: ${result.culprits.join('; ')}`).toBe(false);
}

/** Visible controls smaller than 44 x 44 (after rounding), described as `tag.class "text" WxH`. */
export async function smallTapTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = 'button, .button, [role=tab], select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), nav a, .tabbar a, .topbar a';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest('.cal-block, .cal-strip-item, .sr-only')) continue;
      if (el.tagName === 'A' && el.closest('p, li, .prose') && !el.closest('nav, .tabbar, .topbar')) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w < 44 || h < 44) out.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(/\s+/).join('.')} "${(el.textContent ?? '').trim().slice(0, 30)}" ${w}x${h}`);
    }
    return out;
  });
}

/** Visible inputs, selects and textareas whose text is under 16px (phones zoom the page in on those). */
export async function smallInputText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea'))) {
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`${el.tagName.toLowerCase()}#${el.id} ${size}px`);
    }
    return out;
  });
}

/** Opens the drawer menu and returns it. */
export async function openMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Menu' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Full-page screenshot to $MOBILE_SHOTS/<name>.png, only when that variable is set. */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.MOBILE_SHOTS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
