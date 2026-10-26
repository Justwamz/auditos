import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
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
  await expect(page).toHaveURL(/\/$/);
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
