import type { PaletteVar } from '@auditos/brand';

/**
 * The firm's palette as CSS declarations. Only the brand tokens below can ever be written (never a status,
 * success or calendar colour), and each accepts only the one kind of plain value it should hold, so nothing
 * from the palette can break out of the rule.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;
const TRIPLE = /^\d{1,3}, \d{1,3}, \d{1,3}$/;
const RGBA = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (?:0|1|0?\.\d{1,3}|1\.0)\)$/;

const KIND: Record<PaletteVar, RegExp> = {
  '--ledger': HEX, '--ledger-deep': HEX, '--ledger-wash': HEX, '--rule': HEX, '--rule-strong': HEX, '--paper': HEX, '--sheet': HEX,
  '--rail-bg': HEX, '--rail-fg': HEX, '--rail-muted': HEX, '--rail-heading': HEX, '--rail-hover-border': HEX, '--rail-line': HEX,
  '--accent': HEX, '--accent-wash': HEX,
  '--rail-active': RGBA,
  '--shadow-tint': TRIPLE,
};
const KEYS = Object.keys(KIND) as PaletteVar[];

/** `--ledger: #2e6b4c; …` for a saved palette, or '' when the firm has none (the stylesheet defaults then apply). */
export function themeStyle(palette: Record<string, string> | null | undefined): string {
  if (!palette) return '';
  return KEYS.filter((k) => typeof palette[k] === 'string' && KIND[k].test(palette[k]!)).map((k) => `${k}: ${palette[k]};`).join(' ');
}
