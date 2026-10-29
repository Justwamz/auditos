import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_BRAND, derivePalette } from '@auditos/brand';
import { themeStyle } from '../lib/theme';

const decls = (css: string): Record<string, string> =>
  Object.fromEntries(css.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));

/** The custom properties of the :root block in globals.css, as the browser sees them today. */
function rootTokens(): Record<string, string> {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const block = /:root\s*\{([^}]*)\}/.exec(css)![1]!.replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

describe('themeStyle', () => {
  test('no saved branding gives nothing', () => {
    expect(themeStyle(null)).toBe('');
  });

  test('the default palette matches the :root block of globals.css exactly (pixel for pixel)', () => {
    const d = decls(themeStyle(derivePalette(DEFAULT_BRAND).palette));
    const root = rootTokens();
    for (const key of ['--ledger', '--ledger-deep', '--ledger-wash', '--rule', '--rule-strong', '--paper', '--sheet']) {
      expect(d[key], key).toBe(root[key]);
    }
    expect(Object.keys(d)).toHaveLength(17);
    // The rail and shadow fallbacks live inside var(--x, fallback) in the stylesheet.
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    for (const key of ['--rail-bg', '--rail-fg', '--rail-muted', '--rail-heading', '--rail-hover-border', '--rail-active', '--rail-line', '--shadow-tint']) {
      expect(css, key).toContain(`var(${key}, ${d[key]})`);
    }
    expect(d['--accent-wash']).toBe(root['--ledger-wash']);
  });

  test('a red palette sets the brand colours and never a status, success or calendar colour', () => {
    const css = themeStyle(derivePalette({ primary: '#b42318', secondary: '#fbe9e6' }).palette);
    const d = decls(css);
    expect(d['--ledger']).toMatch(/^#[0-9a-f]{6}$/);
    expect(d['--rail-bg']).toMatch(/^#[0-9a-f]{6}$/);
    for (const key of Object.keys(d)) expect(key).not.toMatch(/^--(red-|amber|kind-|ok|primary|secondary)/);
    for (const bad of ['--red-pen:', '--red-wash:', '--amber:', '--amber-wash:', '--ok:', '--ok-deep:', '--ok-wash:', '--kind-', 'primary:', 'secondary:']) {
      expect(css).not.toContain(bad);
    }
  });

  test('a value that is not a plain colour is dropped, and so is an unknown key', () => {
    const css = themeStyle({ '--ledger': 'red; } body { display: none', '--rail-bg': 'url(http://x)', '--paper': '#f3f6f0', '--evil': '#000000', '--red-pen': '#000000', '--ok': '#000000' });
    expect(decls(css)).toEqual({ '--paper': '#f3f6f0' });
    expect(css).not.toMatch(/[{}<>]|url|display/);
  });

  test('each token takes only its own kind of value', () => {
    expect(themeStyle({ '--ledger': 'rgba(1, 2, 3, 0.5)', '--rail-active': '#ffffff', '--shadow-tint': '#ffffff' })).toBe('');
    expect(decls(themeStyle({ '--rail-active': 'rgba(255, 255, 255, 0.16)', '--shadow-tint': '30, 74, 52' }))).toEqual({ '--shadow-tint': '30, 74, 52', '--rail-active': 'rgba(255, 255, 255, 0.16)' });
  });
});
