import type { PoolClient } from 'pg';
import { DEFAULT_BRAND, derivePalette, type Palette } from '@auditos/brand';

export interface BrandingRow {
  primary: string | null;
  secondary: string | null;
  logoId: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  footerNote: string | null;
}

/** The saved branding of the firm of this transaction, or null when nothing has been saved. */
export async function loadBrandingRow(tx: PoolClient): Promise<BrandingRow | null> {
  const r = (await tx.query('select primary_color, secondary_color, logo_id, phone, email, website, footer_note from firm_branding where tenant_id = app_tenant()')).rows[0];
  if (!r) return null;
  return { primary: r.primary_color, secondary: r.secondary_color, logoId: r.logo_id, phone: r.phone, email: r.email, website: r.website, footerNote: r.footer_note };
}

/** The palette for what is saved (the colours were stored already adjusted, so nothing changes here). */
export const paletteOf = (row: BrandingRow | null): Palette =>
  derivePalette({ primary: row?.primary ?? DEFAULT_BRAND.primary, secondary: row?.secondary ?? DEFAULT_BRAND.secondary }).palette;

/** The theme sent with /me: the palette, the name to show and the current logo; null when the firm has saved none or only the default look. */
export async function loadTheme(tx: PoolClient, firmName: string): Promise<{ palette: Palette; name: string; logoId: string | null } | null> {
  const row = await loadBrandingRow(tx);
  if (!row) return null;
  // A firm whose saved look is the default (no logo, default colours) keeps the plain AuditOS menu.
  const same = (a: string | null, b: string) => (a ?? b).toLowerCase() === b.toLowerCase();
  if (!row.logoId && same(row.primary, DEFAULT_BRAND.primary) && same(row.secondary, DEFAULT_BRAND.secondary)) return null;
  // The firm's own name for every role (the legal name sits behind billing permissions, so it is not used here).
  return { palette: paletteOf(row), name: firmName, logoId: row.logoId };
}
