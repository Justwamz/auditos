import { expect, test, type Page } from '@playwright/test';
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
  const email = 'grace.kangethe@kangethe.example.test';
  const primary = (page: Page) => page.locator('main button:not(.secondary):not(.quiet):not(.choice-row)');

  test('credentials and code steps: name, plain sentence under each heading, one primary button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'AuditOS', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in', level: 2 })).toBeVisible();
    await expect(page.getByText('Use your work email and password.')).toBeVisible();
    await expect(primary(page)).toHaveCount(1);
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
    await expect(primary(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/authenticator/i);
  });

  test('set-up step uses plain words', async ({ page }) => {
    // The login and enrol calls are mocked so no real account is changed.
    await page.route('**/api/auth/login', (route) => route.fulfill({ json: { challengeId: 'c1', mfaEnrolled: false } }));
    await page.route('**/api/auth/mfa/enroll', (route) =>
      route.fulfill({ json: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/AuditOS:test?secret=JBSWY3DPEHPK3PXP' } }),
    );
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'any-password-123');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your sign-in code', level: 2 })).toBeVisible();
    await expect(page.getByText('Add the setup code to a code app on your phone, then type the 6-digit code it shows.')).toBeVisible();
    await expect(page.getByText('Setup code', { exact: true })).toBeVisible();
    await expect(page.getByText("Can't scan? Use this link")).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/authenticator/i);
    await expect(primary(page)).toHaveCount(1);
  });

  test('firm choice lists firms as large selectable rows', async ({ page }) => {
    // GET /me is mocked because the seeded users each belong to a single firm.
    await page.route('**/api/me', (route) =>
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
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', user(email).password);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForSelector('#code');
    await page.fill('#code', await freshCode(email));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a firm', level: 2 })).toBeVisible();
    await expect(page.getByText('Pick the firm you want to work in now.')).toBeVisible();
    await expect(primary(page)).toHaveCount(0);
    const rows = page.locator('.choice-row');
    await expect(rows).toHaveCount(2);
    const box = await rows.first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(56);
    expect(box!.width).toBeGreaterThan(300);
  });

  test('invitation page uses plain words', async ({ page }) => {
    await page.goto('/accept-invite?token=example');
    await expect(page.getByRole('heading', { name: 'AuditOS', level: 1 })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Set your password', level: 1 })).toBeVisible();
    await expect(page.getByText('You will set up your sign-in code on your phone the first time you sign in.')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/authenticator/i);
  });
});
