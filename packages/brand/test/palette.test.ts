import { describe, expect, test } from 'vitest';
import { DEFAULT_BRAND, contrastRatio, derivePalette, isHex } from '../src';

// Today's values, copied from apps/web/app/globals.css (:root and the .rail rules).
const TODAY = {
  '--ledger': '#2e6b4c',
  '--ledger-deep': '#1e4a34',
  '--ledger-wash': '#e3eee4',
  '--rule': '#cdd6c8',
  '--rule-strong': '#9aa893',
  '--paper': '#f3f6f0',
  '--sheet': '#fbfcf9',
  '--rail-bg': '#235640', // gradient start of .rail
  '--rail-fg': '#e9f1ea', // .rail text
  '--rail-muted': '#b7ccbc', // .rail .firm / .who
  '--rail-active': 'rgba(255, 255, 255, 0.16)', // .rail nav a[aria-current]
  '--rail-line': '#7fa38c', // .rail button.secondary border
  '--shadow-tint': '30, 74, 52', // rgba(30, 74, 52, ...) in --shadow-1..3
  '--accent': '#e3eee4',
  '--accent-wash': '#e3eee4',
  primary: '#2e6b4c',
  secondary: '#e3eee4',
};

const hue = (hex: string): { h: number; s: number } => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return { h: 0, s: 0 };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: d };
};
const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe('contrastRatio / isHex', () => {
  test('black on white is 21', () => expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5));
  test('isHex', () => {
    expect(isHex('#1a2b3c')).toBe(true);
    expect(isHex('#1A2B3C')).toBe(true);
    expect(isHex('1a2b3c')).toBe(false);
    expect(isHex('#abc')).toBe(false);
  });
  test('default brand', () => expect(DEFAULT_BRAND).toEqual({ primary: '#2e6b4c', secondary: '#e3eee4' }));
});

describe('derivePalette', () => {
  test('defaults reproduce today exactly with no adjustments', () => {
    const r = derivePalette({ primary: '#2e6b4c', secondary: '#e3eee4' });
    expect(r.palette).toEqual(TODAY);
    expect(r.adjustments).toEqual([]);
  });

  test.each(['#ffffff', '#ffff00', '#fde047', '#ff0000', '#000000', '#f8f8f8', '#0000ff', '#2e6b4c'])(
    'primary %s is readable under white text and keeps its hue',
    (input) => {
      const { palette, adjustments } = derivePalette({ primary: input, secondary: '#e3eee4' });
      expect(contrastRatio(palette['--ledger'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette['--rail-fg'], palette['--rail-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette['--rail-muted'], palette['--rail-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette['--ledger-deep'], palette['--paper'])).toBeGreaterThanOrEqual(4.5);
      const before = hue(input);
      if (before.s > 0) expect(hueGap(before.h, hue(palette['--ledger']).h)).toBeLessThanOrEqual(8);
      const changed = palette['--ledger'] !== input;
      expect(adjustments.some((a) => a.field === 'primary')).toBe(changed);
      const adj = adjustments.find((a) => a.field === 'primary');
      if (adj) {
        expect(adj.from).toBe(input);
        expect(adj.to).toBe(palette['--ledger']);
        expect(adj.reason).toMatch(/white text/);
      }
    },
  );

  test('white secondary is adjusted because it vanishes into the page', () => {
    const { palette, adjustments } = derivePalette({ primary: '#2e6b4c', secondary: '#ffffff' });
    expect(adjustments.some((a) => a.field === 'secondary')).toBe(true);
    expect(palette['--accent']).not.toBe('#ffffff');
  });

  test('secondary equal to primary is adjusted', () => {
    const { adjustments } = derivePalette({ primary: '#2e6b4c', secondary: '#2e6b4c' });
    expect(adjustments.some((a) => a.field === 'secondary')).toBe(true);
  });

  test('dark secondary keeps ink readable', () => {
    const { palette } = derivePalette({ primary: '#2e6b4c', secondary: '#101010' });
    expect(contrastRatio('#1d2733', palette['--accent'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#1d2733', palette['--accent-wash'])).toBeGreaterThanOrEqual(4.5);
  });

  test('invalid hex throws', () => {
    expect(() => derivePalette({ primary: 'green', secondary: '#e3eee4' })).toThrow('colour code must look like #1a2b3c');
    expect(() => derivePalette({ primary: '#2e6b4c', secondary: '#12345' })).toThrow(Error);
  });
});
