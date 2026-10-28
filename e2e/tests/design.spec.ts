import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';

test('uses Inter everywhere', async ({ page }) => {
  await signIn(page, 'grace.kangethe@kangethe.example.test');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      body: getComputedStyle(document.body).fontFamily,
      h1: getComputedStyle(document.querySelector('h1')!).fontFamily,
      loaded: document.fonts.check('16px Inter'),
    };
  });
  expect(fonts.body).toMatch(/^"?Inter/);
  expect(fonts.h1).toMatch(/^"?Inter/);
  expect(fonts.loaded).toBe(true);
});
