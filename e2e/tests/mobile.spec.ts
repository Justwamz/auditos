import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, PHONE, TABLET, expectNoHorizontalOverflow, openMenu, shot, signIn, smallInputText, smallTapTargets } from '../helpers';

const grace = 'grace.kangethe@kangethe.example.test';

const menuButton = (page: Page) => page.getByRole('button', { name: 'Menu', exact: true });
const mainLinks = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, grace);
});

test('phone: Menu opens a drawer with the same links, and Today fits', async ({ page }) => {
  await page.goto('/');
  const desktopHrefs = await mainLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(desktopHrefs.length).toBeGreaterThan(0);

  await page.setViewportSize(PHONE);
  // Grace is a firm administrator, so '/' sends her to Clients, whose table is made to fit in a later task.
  // Help is a plain page that must already fit at phone width.
  await page.goto('/help');
  await expect(menuButton(page)).toBeVisible();
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
  for (const link of await mainLinks(page).all()) await expect(link).toBeHidden();
  await expectNoHorizontalOverflow(page, 'help');
  expect(await smallTapTargets(page)).toEqual([]);
  expect(await smallInputText(page)).toEqual([]);
  await shot(page, 'phone-today');

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
