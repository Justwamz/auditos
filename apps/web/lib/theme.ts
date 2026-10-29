/**
 * The firm's palette as CSS declarations. Only the brand tokens below can ever be written (never a status or
 * calendar colour), and only plain colour values are accepted, so nothing from the palette can break out of the rule.
 */
const KEYS = [
  '--ledger', '--ledger-deep', '--ledger-wash', '--rule', '--rule-strong', '--paper', '--sheet',
  '--rail-bg', '--rail-fg', '--rail-muted', '--rail-heading', '--rail-hover-border', '--rail-active', '--rail-line',
  '--shadow-tint', '--accent', '--accent-wash',
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const TRIPLE = /^\d{1,3}, \d{1,3}, \d{1,3}$/;
const RGBA = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (?:0|1|0?\.\d{1,3}|1\.0)\)$/;

const ok = (v: unknown): v is string => typeof v === 'string' && (HEX.test(v) || TRIPLE.test(v) || RGBA.test(v));

/** `--ledger: #2e6b4c; …` for a saved palette, or '' when the firm has none (the stylesheet defaults then apply). */
export function themeStyle(palette: Record<string, string> | null | undefined): string {
  if (!palette) return '';
  return KEYS.filter((k) => ok(palette[k])).map((k) => `${k}: ${palette[k]};`).join(' ');
}
