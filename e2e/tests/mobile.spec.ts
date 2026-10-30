import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, PHONE, TABLET, expectNoHorizontalOverflow, openMenu, shot, signIn, smallInputText, smallTapTargets } from '../helpers';

const grace = 'grace.kangethe@kangethe.example.test';

const menuButton = (page: Page) => page.getByRole('button', { name: 'Menu', exact: true });
const mainLinks = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, grace);
});

test('phone: Menu opens a drawer with the same links, and Clients fits', async ({ page }) => {
  await page.goto('/');
  const desktopHrefs = await mainLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(desktopHrefs.length).toBeGreaterThan(0);

  await page.setViewportSize(PHONE);
  await page.goto('/clients');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(menuButton(page)).toBeVisible();
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
  for (const link of await mainLinks(page).all()) await expect(link).toBeHidden();
  await expectNoHorizontalOverflow(page, 'clients');
  expect(await smallTapTargets(page)).toEqual([]);
  expect(await smallInputText(page)).toEqual([]);
  await shot(page, 'phone-clients');

  const dialog = await openMenu(page);
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  const hrefs = await dialog.getByRole('navigation', { name: 'Main' }).getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs).toEqual(desktopHrefs);
  expect(hrefs.length).toBeLessThanOrEqual(10);
  await shot(page, 'phone-menu-open');
});

test('phone: Escape and tapping outside close the menu and focus returns to Menu', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  const dialog = await openMenu(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Menu');

  await openMenu(page);
  await page.mouse.click(PHONE.width - 10, 400);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);

  await openMenu(page);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  }
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
});

test('phone: choosing a link goes there and closes the menu', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  const dialog = await openMenu(page);
  await dialog.getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
});

test('tablet uses the drawer; desktop keeps the side menu', async ({ page }) => {
  await page.setViewportSize(TABLET);
  await page.goto('/');
  await expect(menuButton(page)).toBeVisible();
  await expectNoHorizontalOverflow(page, 'today at tablet');
  await page.setViewportSize(DESKTOP);
  await expect(menuButton(page)).toBeHidden();
  for (const link of await mainLinks(page).all()) await expect(link).toBeVisible();
});

test('widening the window with the menu open gives the normal side menu', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await openMenu(page);
  await page.setViewportSize(DESKTOP);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  for (const link of await mainLinks(page).all()) await expect(link).toBeVisible();
});

test('reduced motion: the drawer does not slide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await openMenu(page);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('main-menu')!).transitionDuration)).toBe('0s');
});

test('the page behind the open menu cannot be reached', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/clients');
  await openMenu(page);
  expect(await page.evaluate(() => document.getElementById('content')!.hasAttribute('inert'))).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.getElementById('content')!.hasAttribute('inert'))).toBe(false);
});

test('phone: Clients and Prospects show stacked rows', async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const path of ['/clients', '/pipeline']) {
    await page.goto(path);
    const table = page.locator('main table.stack-table').first();
    await expect(table).toBeVisible();
    await expect(table.locator('thead')).toBeHidden();
    const heading = (await table.locator('thead th').first().textContent())!.trim();
    const before = await table.locator('tbody tr').first().locator('td').first().evaluate((el) => getComputedStyle(el, '::before').content);
    expect(before.replace(/^"|"$/g, '')).toBe(heading);
    await expectNoHorizontalOverflow(page, path);
    await shot(page, `phone-stacked${path.replace('/', '-')}`);
  }
  await page.setViewportSize(TABLET);
  await page.goto('/pipeline');
  await expect(page.locator('main table.stack-table thead').first()).toBeVisible();
});

test('phone: a side panel fills the screen with its buttons in reach', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/clients');
  await page.locator('main button', { hasText: /^\+ / }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  const box = (await dialog.boundingBox())!;
  expect(Math.round(box.width)).toBe(PHONE.width);
  expect(Math.round(box.height)).toBe(PHONE.height);
  const foot = (await dialog.locator('.side-panel-foot').boundingBox())!;
  expect(foot.y + foot.height).toBeLessThanOrEqual(PHONE.height + 0.5);
  await shot(page, 'phone-side-panel');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize(TABLET);
  await page.locator('main button', { hasText: /^\+ / }).first().click();
  await page.waitForTimeout(400);
  expect(Math.round((await page.getByRole('dialog').boundingBox())!.width)).toBe(440);
});

test('phone: tabs scroll sideways and the chosen tab is in view', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  const tabs = page.getByRole('tablist', { name: 'Engagement sections' }).getByRole('tab');
  await tabs.last().click();
  await page.waitForTimeout(500);
  const box = (await tabs.last().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 0.5);
  await expectNoHorizontalOverflow(page, 'engagement tabs');
  await shot(page, 'phone-engagement-tabs');
});

test('phone: a row menu stays on screen', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/pipeline');
  await page.locator('.row-menu-btn').first().click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  for (const item of await menu.getByRole('menuitem').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, 'phone-row-menu');
});
