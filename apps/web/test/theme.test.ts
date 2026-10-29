import { describe, expect, test } from 'vitest';
import { DEFAULT_BRAND, derivePalette } from '../../../packages/brand/src/index';
import { themeStyle } from '../lib/theme';

const decls = (css: string): Record<string, string> =>
  Object.fromEntries(css.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));

describe('themeStyle', () => {
  test('no saved branding gives nothing', () => {
    expect(themeStyle(null)).toBe('');
  });

  test('the default palette is exactly the values the stylesheet has today', () => {
    const d = decls(themeStyle(derivePalette(DEFAULT_BRAND).palette));
    expect(d).toEqual({
      '--ledger': '#2e6b4c',
      '--ledger-deep': '#1e4a34',
      '--ledger-wash': '#e3eee4',
      '--rule': '#cdd6c8',
      '--rule-strong': '#9aa893',
      '--paper': '#f3f6f0',
      '--sheet': '#fbfcf9',
      '--rail-bg': '#235640',
      '--rail-fg': '#e9f1ea',
      '--rail-muted': '#b7ccbc',
      '--rail-heading': '#a9c4b1',
      '--rail-hover-border': '#cfe0d4',
      '--rail-active': 'rgba(255, 255, 255, 0.16)',
      '--rail-line': '#7fa38c',
      '--shadow-tint': '30, 74, 52',
      '--accent': '#e3eee4',
      '--accent-wash': '#e3eee4',
    });
  });

  test('a red palette sets the brand colours and never a status or calendar colour', () => {
    const css = themeStyle(derivePalette({ primary: '#b42318', secondary: '#fbe9e6' }).palette);
    const d = decls(css);
    expect(d['--ledger']).toMatch(/^#[0-9a-f]{6}$/);
    expect(d['--rail-bg']).toMatch(/^#[0-9a-f]{6}$/);
    for (const bad of ['--red-pen', '--red-wash', '--amber', '--amber-wash', '--kind-', 'primary', 'secondary']) {
      expect(css).not.toContain(`${bad}`.startsWith('--') ? bad + (bad.endsWith('-') ? '' : ':') : `${bad}:`);
    }
  });

  test('a value that is not a plain colour is dropped, and so is an unknown key', () => {
    const css = themeStyle({ '--ledger': 'red; } body { display: none', '--rail-bg': 'url(http://x)', '--paper': '#f3f6f0', '--evil': '#000000', '--red-pen': '#000000' });
    expect(decls(css)).toEqual({ '--paper': '#f3f6f0' });
    expect(css).not.toMatch(/[{}<>]|url|display/);
  });
});
