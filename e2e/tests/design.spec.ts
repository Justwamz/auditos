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
      loadedFaces: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    };
  });
  // next/font hashes the family name (for example "__Inter_abc123"), so match loosely.
  expect(fonts.body).toMatch(/^["']?_*inter/i);
  expect(fonts.h1).toMatch(/^["']?_*inter/i);
  expect(fonts.loadedFaces.some((family) => /inter/i.test(family))).toBe(true);
});
