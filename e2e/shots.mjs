// Throwaway: logs in to the dev servers and captures screenshots for a visual check.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const creds = JSON.parse(readFileSync('../apps/api/.seed-credentials.local.json', 'utf8'));
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(s) { let bits = 0, v = 0; const out = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secret, step) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step)); const m = createHmac('sha1', b32(secret)).update(c).digest(); const o = m[m.length - 1] & 15; return String((((m[o] & 127) << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]) % 1e6).padStart(6, '0'); }

const out = process.env.SHOTS ?? '../.superpowers/shots';
mkdirSync(out, { recursive: true });
const u = creds.users.find((x) => x.email === (process.env.WHO ?? 'partner@firm-a.example.test'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('console', (m) => { if (['error','warning'].includes(m.type())) console.log('console', m.type(), m.text().slice(0, 1800)); });
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
await page.goto('http://localhost:3000/login');
await page.screenshot({ path: `${out}/01-login.png` });
await page.fill('#email', u.email);
await page.fill('#password', creds.password);
await page.click('button:has-text("Continue")');
await page.waitForSelector('#code');
await page.fill('#code', totp(u.totpSecret, Math.floor(Date.now() / 30000)));
await page.click('button:has-text("Sign in")');
await page.waitForURL('http://localhost:3000/');
await page.waitForSelector('text=Your engagements');
await page.screenshot({ path: `${out}/02-dashboard.png`, fullPage: true });
await page.goto('http://localhost:3000/engagements');
await page.waitForSelector('text=Mwangaza');
const link = page.locator('a:has-text("Mwangaza Traders Ltd")').first();
await link.click();
await page.waitForSelector('text=Where this engagement is');
await page.screenshot({ path: `${out}/03-overview.png`, fullPage: true });
await page.click('button[role=tab]:has-text("Working papers")');
await page.waitForSelector('text=Papers on this engagement');
await page.locator('button:has-text("Open")').first().click();
await page.waitForSelector('text=Review notes');
await page.screenshot({ path: `${out}/04-paper.png`, fullPage: true });
await page.click('button[role=tab]:has-text("Checklists")');
await page.click('button:has-text("Generate checklists")');
await page.waitForSelector('text=answered');
await page.screenshot({ path: `${out}/05-checklists.png`, fullPage: true });
await page.click('button[role=tab]:has-text("Financial statements")');
await page.click('button[role=tab]:text-is("Mapping")');
await page.waitForSelector('text=Map accounts');
await page.click('button:has-text("Carry forward from last year")');
await page.click('button[role=tab]:text-is("Statements")');
await page.waitForSelector('text=Statement of financial position');
await page.screenshot({ path: `${out}/06-statements.png`, fullPage: true });
await browser.close();
console.log('shots written');
