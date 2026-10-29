/**
 * Firm brand palette. Two picked colours go in; a full set of theme tokens comes out, with
 * every text/background pair guaranteed to meet WCAG AA (4.5:1). Anything we change is reported
 * back as an Adjustment in plain English so the page can say so.
 *
 * Reference shades are today's globals.css values (the default green). Other palettes are made by
 * rotating those shades to the firm's hue and scaling their saturation, so the default brand
 * reproduces the current theme exactly.
 */

export type Adjustment = { field: 'primary' | 'secondary'; from: string; to: string; reason: string };

export type PaletteVar =
  | '--ledger' | '--ledger-deep' | '--ledger-wash' | '--rule' | '--rule-strong' | '--paper' | '--sheet'
  | '--rail-bg' | '--rail-fg' | '--rail-muted' | '--rail-active' | '--rail-line' | '--shadow-tint'
  | '--accent' | '--accent-wash';
export type Palette = Record<PaletteVar | 'primary' | 'secondary', string>;

export const DEFAULT_BRAND = { primary: '#2e6b4c', secondary: '#e3eee4' } as const;

const INK = '#1d2733';
const HEX = /^#[0-9a-fA-F]{6}$/;
const BAD = 'colour code must look like #1a2b3c';

export const isHex = (s: string): boolean => typeof s === 'string' && HEX.test(s);

type Rgb = [number, number, number];
type Hsl = { h: number; s: number; l: number }; // h 0-360, s and l 0-100

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = ([r, g, b]: Rgb): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function toHsl(hex: string): Hsl {
  const [r, g, b] = toRgb(hex).map((v) => v / 255) as Rgb;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function fromHsl({ h, s, l }: Hsl): string {
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = L - c / 2;
  return toHex([(r1! + m) * 255, (g1! + m) * 255, (b1! + m) * 255]);
}

const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export function contrastRatio(a: string, b: string): number {
  if (!isHex(a) || !isHex(b)) throw new Error(BAD);
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const distance = (a: string, b: string): number => {
  const [x, y] = [toRgb(a), toRgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// Today's green shades (globals.css :root and .rail), the reference the palette is rotated from.
const REF_PRIMARY = toHsl('#2e6b4c');
const REF = {
  deep: '#1e4a34',
  wash: '#e3eee4',
  rule: '#cdd6c8',
  ruleStrong: '#9aa893',
  paper: '#f3f6f0',
  sheet: '#fbfcf9',
  railBg: '#235640',
  railFg: '#e9f1ea',
  railMuted: '#b7ccbc',
  railLine: '#7fa38c',
  shadow: '30, 74, 52',
} as const;

type Shift = { dh: number; sr: number; lr: number };
function adapt(ref: string, { dh, sr, lr }: Shift, useLr: boolean): string {
  if (dh === 0 && sr === 1 && (!useLr || lr === 1)) return ref;
  const c = toHsl(ref);
  return fromHsl({ h: c.h + dh, s: c.s * sr, l: useLr ? c.l * lr : c.l });
}

const COLOUR_NAMES: [number, string][] = [
  [15, 'red'], [45, 'orange'], [70, 'yellow'], [165, 'green'], [200, 'teal'], [255, 'blue'], [290, 'purple'], [345, 'pink'], [361, 'red'],
];
const nameOf = (hex: string): string => {
  const { h, s } = toHsl(hex);
  if (s < 8) return 'grey';
  return COLOUR_NAMES.find(([max]) => h < max)![1];
};

function fixPrimary(primary: string): string {
  let c = toHsl(primary);
  while (contrastRatio(fromHsl(c), '#ffffff') < 4.5 && c.l > 0) c = { ...c, l: Math.max(0, c.l - 2) };
  return fromHsl(c);
}

function fixSecondary(secondary: string, primary: string, paper: string, sheet: string): string {
  const base = toHsl(secondary);
  const p = toHsl(primary);
  const ok = (hex: string): boolean => {
    const c = toHsl(hex);
    const apart = Math.abs(c.l - p.l) >= 15 || (hueGap(c.h, p.h) >= 30 && c.s >= 15 && p.s >= 15);
    return (
      apart &&
      contrastRatio(INK, hex) >= 4.5 &&
      distance(hex, sheet) >= 20 &&
      distance(hex, paper) >= 12 &&
      distance(hex, primary) >= 40
    );
  };
  if (ok(secondary)) return secondary;
  // Try the nearest lightness first, in both directions, 2% at a time.
  for (let step = 2; step <= 100; step += 2) {
    for (const dir of [-1, 1]) {
      const l = base.l + dir * step;
      if (l < 0 || l > 100) continue;
      const cand = fromHsl({ ...base, l });
      if (ok(cand)) return cand;
    }
  }
  return secondary;
}

export function derivePalette(input: { primary: string; secondary: string }): { palette: Palette; adjustments: Adjustment[] } {
  if (!isHex(input.primary) || !isHex(input.secondary)) throw new Error(BAD);
  const adjustments: Adjustment[] = [];
  const pIn = input.primary.toLowerCase();
  const sIn = input.secondary.toLowerCase();

  const primary = fixPrimary(pIn);
  if (primary !== pIn) {
    adjustments.push({
      field: 'primary',
      from: pIn,
      to: primary,
      reason: `We made your ${nameOf(pIn)} a little darker so white text stays easy to read.`,
    });
  }

  const hsl = toHsl(primary);
  const shift: Shift = {
    dh: hsl.s === 0 ? 0 : hsl.h - REF_PRIMARY.h,
    sr: Math.max(0, Math.min(1.5, hsl.s / REF_PRIMARY.s)),
    lr: hsl.l / REF_PRIMARY.l,
  };
  const at = (ref: string, useLr = false): string => adapt(ref, shift, useLr);

  const paper = at(REF.paper);
  const sheet = at(REF.sheet);

  // Deep shade: used for links on the page, so keep it readable on paper.
  let deep = at(REF.deep, true);
  for (let c = toHsl(deep); contrastRatio(deep, paper) < 4.5 && c.l > 0; ) {
    c = { ...c, l: Math.max(0, c.l - 2) };
    deep = fromHsl(c);
  }
  const railBg = at(REF.railBg, true);

  // Rail text: lighten until it clears 4.5:1 on both ends of the rail gradient.
  const onRail = (hex: string): string => {
    const start = toHsl(hex);
    let c = start;
    while ((contrastRatio(fromHsl(c), railBg) < 4.5 || contrastRatio(fromHsl(c), deep) < 4.5) && c.l < 100) {
      c = { ...c, l: Math.min(100, c.l + 2) };
    }
    return c.l === start.l ? hex : fromHsl(c);
  };

  const secondary = fixSecondary(sIn, primary, paper, sheet);
  if (secondary !== sIn) {
    adjustments.push({
      field: 'secondary',
      from: sIn,
      to: secondary,
      reason: 'We shifted your second colour a little so it stands out from the page and from your main colour, and dark text stays easy to read on it.',
    });
  }
  const sh = toHsl(secondary);
  const accentWash = sh.l < 88 ? fromHsl({ h: sh.h, s: Math.min(sh.s, 45), l: 92 }) : secondary;

  const identity = shift.dh === 0 && shift.sr === 1 && shift.lr === 1;
  const palette: Palette = {
    '--ledger': primary,
    '--ledger-deep': deep,
    '--ledger-wash': at(REF.wash),
    '--rule': at(REF.rule),
    '--rule-strong': at(REF.ruleStrong),
    '--paper': paper,
    '--sheet': sheet,
    '--rail-bg': railBg,
    '--rail-fg': onRail(at(REF.railFg)),
    '--rail-muted': onRail(at(REF.railMuted)),
    '--rail-active': 'rgba(255, 255, 255, 0.16)',
    '--rail-line': at(REF.railLine),
    '--shadow-tint': identity ? REF.shadow : toRgb(deep).join(', '),
    '--accent': secondary,
    '--accent-wash': accentWash,
    primary,
    secondary,
  };
  return { palette, adjustments };
}
