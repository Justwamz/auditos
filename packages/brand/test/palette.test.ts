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
  '--rail-heading': '#a9c4b1', // .rail .nav-heading
  '--rail-hover-border': '#cfe0d4', // .rail button.secondary:hover
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

describe('sweep of deterministic inputs', () => {
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const hex = (): string =>
    '#' + [0, 1, 2].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
  const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const blend = (bg: string, a: number): string =>
    '#' + rgb(bg).map((v) => Math.round(v * (1 - a) + 255 * a).toString(16).padStart(2, '0')).join('');
  const pairs = Array.from({ length: 300 }, () => ({ primary: hex(), secondary: hex() }));
  const edge = ['#ffffff', '#000000', '#ffff00', '#00ffff', '#f8f8f8', '#101010'];
  for (const a of edge) for (const b of edge) pairs.push({ primary: a, secondary: b });

  test('every guarantee holds for every input', () => {
    for (const input of pairs) {
      const { palette: p, adjustments } = derivePalette(input);
      const tag = JSON.stringify(input);
      const alpha = Number(/, ([0-9.]+)\)$/.exec(p['--rail-active'])![1]);
      expect(contrastRatio(p['--ledger'], '#ffffff'), tag).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#1d2733', p['--accent-wash']), tag).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#1d2733', p['--accent']), tag).toBeGreaterThanOrEqual(4.5);
      for (const k of ['--rail-fg', '--rail-muted', '--rail-heading'] as const) {
        expect(contrastRatio(p[k], p['--rail-bg']), tag + k).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p[k], p['--ledger-deep']), tag + k).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of [p['--rail-bg'], p['--ledger-deep']]) {
        expect(contrastRatio('#ffffff', blend(bg, alpha)), tag).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p['--rail-line'], bg), tag).toBeGreaterThanOrEqual(3);
      }
      expect(adjustments.some((x) => x.field === 'secondary'), tag).toBe(p['--accent'] !== input.secondary.toLowerCase());
      expect(adjustments.some((x) => x.field === 'primary'), tag).toBe(p['--ledger'] !== input.primary.toLowerCase());
    }
  });

  test('secondary messages name the colour and the rule', () => {
    const page = derivePalette({ primary: '#2e6b4c', secondary: '#ffffff' }).adjustments[0]!;
    expect(page.reason).toMatch(/grey accent colour .*too close to the page colour/);
    const main = derivePalette({ primary: '#2e6b4c', secondary: '#2e6b4c' }).adjustments[0]!;
    expect(main.reason).toMatch(/green accent colour .*too dark or too bright/);
    const dark = derivePalette({ primary: '#2e6b4c', secondary: '#101010' }).adjustments[0]!;
    expect(dark.reason).toMatch(/too dark or too bright/);
  });
});

describe('accent colour follows the main colour until one is picked', () => {
  const hueOf = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const d = Math.max(r, g, b) - Math.min(r, g, b);
    const m = Math.max(r, g, b);
    const h = m === r ? ((g - b) / d) % 6 : m === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const gap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  test('a red main colour with the default accent gives a red accent, not the green wash', () => {
    const { palette: p, adjustments } = derivePalette({ primary: '#cc0000', secondary: DEFAULT_BRAND.secondary });
    expect(p['--accent-wash']).not.toBe('#e3eee4');
    expect(p['--accent']).toBe(p['--ledger-wash']);
    expect(p['--accent-wash']).toBe(p['--ledger-wash']);
    expect(gap(hueOf(p['--accent-wash']), 0)).toBeLessThan(25);
    expect(adjustments.filter((a) => a.field === 'secondary')).toEqual([]);
  });

  test('a blue main colour with the default accent gives a blue accent', () => {
    const { palette: p } = derivePalette({ primary: '#1d4ed8', secondary: DEFAULT_BRAND.secondary });
    expect(gap(hueOf(p['--accent-wash']), hueOf('#1d4ed8'))).toBeLessThan(25);
    expect(contrastRatio('#1d2733', p['--accent-wash'])).toBeGreaterThanOrEqual(4.5);
  });

  test('the default pair is unchanged', () => {
    const { palette: p } = derivePalette(DEFAULT_BRAND);
    expect(p['--accent']).toBe('#e3eee4');
    expect(p['--accent-wash']).toBe('#e3eee4');
  });

  test('an explicit accent is respected, whatever the main colour', () => {
    const { palette: p } = derivePalette({ primary: '#cc0000', secondary: '#e0e7ff' });
    expect(p['--accent']).toBe('#e0e7ff');
    const q = derivePalette({ primary: DEFAULT_BRAND.primary, secondary: '#e0e7ff' }).palette;
    expect(q['--accent']).toBe('#e0e7ff');
  });

  test('contrast is still guaranteed with the default accent over a sweep of main colours', () => {
    for (let h = 0; h < 360; h += 5) for (const [s, l] of [[90, 50], [70, 30], [100, 85], [20, 50], [100, 10]] as const) {
      const hsl = `hsl(${h} ${s}% ${l}%)`;
      const c = (n: number) => {
        const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
        const f = (k: number) => l / 100 - a * Math.max(-1, Math.min((k + h / 30) % 12 - 3, 9 - ((k + h / 30) % 12), 1));
        return Math.round(f(n) * 255).toString(16).padStart(2, '0');
      };
      const primary = `#${c(0)}${c(8)}${c(4)}`;
      const { palette: p } = derivePalette({ primary, secondary: DEFAULT_BRAND.secondary });
      expect(contrastRatio('#1d2733', p['--accent-wash']), hsl + primary).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#1d2733', p['--accent']), hsl + primary).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('link colours stay readable', () => {
  test('--ledger-deep (used for links and their hover) reads on the page and the sheet for many main colours', () => {
    for (let n = 0; n < 400; n++) {
      const primary = '#' + ((n * 2654435761) >>> 0).toString(16).padStart(8, '0').slice(0, 6);
      const { palette: p } = derivePalette({ primary, secondary: DEFAULT_BRAND.secondary });
      expect(contrastRatio(p['--ledger-deep'], p['--paper']), primary).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p['--ledger-deep'], p['--sheet']), primary).toBeGreaterThanOrEqual(4.5);
    }
  });
});
