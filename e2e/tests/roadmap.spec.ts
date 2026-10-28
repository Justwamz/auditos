import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';

test('the engagement opens on a roadmap with one next step, and materiality can be calculated', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();

  await expect(page.getByRole('heading', { name: 'Audit roadmap' })).toBeVisible();
  await expect(page.getByText('Your next step')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Audit progress' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Pre-planning meeting' })).toBeVisible();

  await page.getByRole('tab', { name: 'Working papers' }).click();
  await page.getByLabel('Benchmark amount (KES)').fill('120000000');
  await page.getByLabel('Why this benchmark and percentage').fill('Revenue is the stable benchmark for a trading entity.');
  await page.getByRole('button', { name: 'Calculate and save' }).click();
  await expect(page.getByText('KES 1,200,000.00')).toBeVisible();
  await expect(page.getByText('KES 900,000.00')).toBeVisible();
});

test('engagements are a table with search, stage chips and an "+ Open an engagement" panel', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await page.goto('/engagements');
  await expect(page.getByRole('heading', { name: 'Engagements', level: 1 })).toBeVisible();
  const table = page.getByRole('table');
  await expect(table.getByRole('row', { name: /Mwangaza Traders Ltd/ }).first()).toBeVisible();

  const stages = page.getByRole('group', { name: 'Stage' });
  await expect(stages.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Getting ready', 'Fieldwork', 'In review', 'Finished']) await expect(stages.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search engagements' }).fill('zzzz-nothing');
  await expect(page.getByText('No engagements match')).toBeVisible();
  await page.getByRole('button', { name: 'Show everything' }).click();
  await expect(table.getByRole('row', { name: /Mwangaza Traders Ltd/ }).first()).toBeVisible();

  await page.getByRole('button', { name: '+ Open an engagement' }).click();
  const panel = page.getByRole('dialog', { name: 'Open an engagement' });
  for (const f of ['Client', 'Period start', 'Period end', 'Engagement partner']) await expect(panel.getByLabel(f)).toBeVisible();
  await expect(panel.getByText(/hold the engagement back until they are done/)).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toHaveCount(0);
});

test('staff cannot open an engagement', async ({ page }) => {
  await signIn(page, 'brian.kiptoo@kangethe.example.test');
  await page.goto('/engagements');
  await expect(page.getByRole('heading', { name: 'Engagements', level: 1 })).toBeVisible();
  // Wait until the page is fully loaded (the list and the role are known) before asserting absence.
  await expect(page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: '+ Open an engagement' })).toHaveCount(0);
});

test('the engagement tabs keep their names and ?tab= values and show the selected one', async ({ page }) => {
  await signIn(page, 'daniel.otieno@kangethe.example.test');
  await page.goto('/engagements');
  await page.getByRole('link', { name: 'Mwangaza Traders Ltd' }).first().click();
  const tabs = page.getByRole('tablist', { name: 'Engagement sections' });
  const want: [string, string][] = [['Overview', 'overview'], ['Working papers', 'papers'], ['Checklists', 'checklists'], ['Evidence', 'evidence'], ['Financial statements', 'financials'], ['Bank statements', 'bank'], ['Sampling', 'sampling']];
  for (const [name, value] of want) {
    await tabs.getByRole('tab', { name }).click({ timeout: 90_000 });
    await expect(page).toHaveURL(new RegExp(`tab=${value}$`));
    await expect(tabs.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  }
  // Same look as the shared tab bar: a 3px green line under the chosen tab, no box.
  const chosen = tabs.getByRole('tab', { selected: true });
  expect(await chosen.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('3px');
  expect(await chosen.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
  // Keyboard focus keeps the global 3px ring.
  await chosen.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  expect(await chosen.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('3px');
});
