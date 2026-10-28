import { expect, test } from '@playwright/test';
import { freshCode, signIn, user } from '../helpers';

test('uses Inter everywhere', async ({ page }) => {
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      body: getComputedStyle(document.body).fontFamily,
      h1: getComputedStyle(document.querySelector('h1')!).fontFamily,
      loadedFaces: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    };
  });
  // next/font hashes the family name (for example "__Inter_abc123"), so match loosely.
  expect(fonts.body).toMatch(/^["']?_*inter/i);
  expect(fonts.h1).toMatch(/^["']?_*inter/i);
  expect(fonts.loadedFaces.some((family) => /inter/i.test(family))).toBe(true);
});

test.describe('sign-in', () => {
  test('is calm and plain: name, one primary button per step, a sentence under each heading', async ({ page }) => {
    const email = 'grace.kangethe@kangethe.example.test';
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'AuditOS', level: 1 })).toBeVisible();
    await expect(page.locator('.login p.muted').first()).toBeVisible();
    await expect(page.locator('main button:not(.secondary):not(.quiet)')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

    // The generic error text is unchanged.
    await page.fill('#email', 'nobody@nowhere.example.test');
    await page.fill('#password', 'not-the-password-123');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('The email or password is wrong, or the account is temporarily locked.')).toBeVisible();

    await page.fill('#email', email);
    await page.fill('#password', user(email).password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForSelector('#code');
    await expect(page.getByRole('heading', { name: 'Enter your code', level: 2 })).toBeVisible();
    await expect(page.getByText('Type the 6-digit code from your phone.')).toBeVisible();
    await expect(page.locator('main button:not(.secondary):not(.quiet)')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/authenticator/i);
  });

  test('firm choice lists firms as large selectable rows', async ({ page }) => {
    await page.route('**/me', (route) =>
      route.fulfill({
        json: {
          activeTenantId: null,
          memberships: [
            { tenantId: 't1', tenantName: 'Kangethe and Co', role: 'partner' },
            { tenantId: 't2', tenantName: 'Mwangi Associates', role: 'staff' },
          ],
        },
      }),
    );
    const email = 'grace.kangethe@kangethe.example.test';
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', user(email).password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForSelector('#code');
    await page.fill('#code', await freshCode(email));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a firm', level: 2 })).toBeVisible();
    await expect(page.getByText('Pick the firm you want to work in now.')).toBeVisible();
    const rows = page.locator('.choice-row');
    await expect(rows).toHaveCount(2);
    const box = await rows.first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(56);
    expect(box!.width).toBeGreaterThan(300);
  });
});
