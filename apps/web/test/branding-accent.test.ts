import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_BRAND } from '@auditos/brand';
import { accentView, BRANDING_POINTER, ACCENT_FOLLOWS_NOTE } from '../lib/branding';
import { findJargon } from '../lib/plain';

describe('accentView (what the accent picker and preview show)', () => {
  test('main colour changed, accent still the standard one: shows the derived light shade and says so', () => {
    const v = accentView('#cc0000', DEFAULT_BRAND.secondary);
    expect(v.derived).toBe(true);
    expect(v.shown).not.toBe(DEFAULT_BRAND.secondary);
    expect(v.note).toBe(ACCENT_FOLLOWS_NOTE);
    expect(ACCENT_FOLLOWS_NOTE).toBe('Using a light shade of your main colour until you pick your own.');
  });
  test('the default pair shows the standard accent and no note', () => {
    expect(accentView(DEFAULT_BRAND.primary, DEFAULT_BRAND.secondary)).toEqual({ shown: DEFAULT_BRAND.secondary, derived: false, note: null });
  });
  test('an accent the firm picked is shown as picked', () => {
    expect(accentView('#cc0000', '#e0e7ff')).toEqual({ shown: '#e0e7ff', derived: false, note: null });
  });
  test('an unfinished colour code shows what is typed', () => {
    expect(accentView('#cc00', '#e3eee4')).toEqual({ shown: '#e3eee4', derived: false, note: null });
  });
  test('the note uses plain words', () => {
    expect(findJargon(ACCENT_FOLLOWS_NOTE)).toEqual([]);
    expect(ACCENT_FOLLOWS_NOTE).not.toMatch(/\bhex\b|\btoken\b|\bcss\b/i);
  });
});

describe('pointer to Branding on Billing settings', () => {
  test('one plain sentence', () => {
    expect(BRANDING_POINTER).toBe('The logo, colours and contact details on your invoices are set by the firm administrator on the Branding page.');
    expect(findJargon(BRANDING_POINTER)).toEqual([]);
  });
  test('the settings page shows it to everyone who can open the page', () => {
    const src = readFileSync(new URL('../app/(app)/billing/settings/page.tsx', import.meta.url), 'utf8');
    expect(src).toContain('BRANDING_POINTER');
    expect(src).not.toMatch(/canEdit\s*&&\s*<[^>]*>\s*\{?\s*BRANDING_POINTER/);
  });
});

describe('link hover colour', () => {
  test('a:hover uses the deep shade, which is guaranteed readable on the page colour', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    const rule = /^a:hover\s*\{([^}]*)\}/m.exec(css)![1]!;
    expect(rule).toContain('var(--ledger-deep)');
    expect(rule).not.toMatch(/color:\s*var\(--ledger\)/);
  });
});
