import type { PoolClient } from 'pg';
import { DEFAULT_BRAND, derivePalette } from '@auditos/brand';

export interface Letterhead {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  kraPin: string | null;
  bankDetails: string | null;
  footerNote: string | null;
  primary: string;
  logoId: string | null;
}

/**
 * The letterhead as it stands now, for the firm of the current transaction. Used when a draft is shown and, once, when a
 * document is issued (the copy is then frozen with the document). The name is the legal name, then the firm name.
 */
export async function loadLetterhead(tx: PoolClient): Promise<Letterhead> {
  // The legal name, address and KRA PIN come through a narrow function, so every member of the firm sees the same ones.
  // Bank details are read from the table itself, which only people with billing rights can see: for anyone else they are null.
  const r = (
    await tx.query(
      `select t.name as firm_name, bs.bank_details,
              fb.primary_color, fb.secondary_color, fb.logo_id, fb.phone, fb.email, fb.website, fb.footer_note
         from tenants t
         left join billing_settings bs on bs.tenant_id = t.id
         left join firm_branding fb on fb.tenant_id = t.id
        where t.id = app_tenant()`,
    )
  ).rows[0] as Record<string, string | null> | undefined;
  const id = (await tx.query('select legal_name, address, kra_pin from firm_letterhead_identity()')).rows[0] as { legal_name: string | null; address: string | null; kra_pin: string | null } | undefined;
  const primary = r?.primary_color
    ? derivePalette({ primary: r.primary_color, secondary: r.secondary_color ?? DEFAULT_BRAND.secondary }).palette.primary
    : DEFAULT_BRAND.primary;
  return {
    name: id?.legal_name || r?.firm_name || 'Audit firm',
    address: id?.address ?? null,
    phone: r?.phone ?? null,
    email: r?.email ?? null,
    website: r?.website ?? null,
    kraPin: id?.kra_pin ?? null,
    bankDetails: r?.bank_details ?? null,
    footerNote: r?.footer_note ?? null,
    primary,
    logoId: r?.logo_id ?? null,
  };
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Reads a stored snapshot defensively: whatever is in the column, the result has the Letterhead shape. */
export function readLetterhead(v: unknown): Letterhead | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const logoId = typeof o.logoId === 'string' && /^[0-9a-f-]{36}$/i.test(o.logoId) ? o.logoId : null;
  return {
    name: text(o.name) ?? 'Audit firm',
    address: text(o.address), phone: text(o.phone), email: text(o.email), website: text(o.website), kraPin: text(o.kraPin),
    bankDetails: text(o.bankDetails), footerNote: text(o.footerNote),
    primary: typeof o.primary === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.primary) ? o.primary : DEFAULT_BRAND.primary,
    logoId,
  };
}

/**
 * The letterhead a document shows. A draft shows the current one. An issued document shows the copy frozen when it was
 * issued; one issued before letterheads existed has none, so it falls back to the current one and says so (`live`).
 */
export async function letterheadFor(tx: PoolClient, stored: unknown, status: string): Promise<{ letterhead: Letterhead; live: boolean }> {
  const frozen = status === 'draft' ? null : readLetterhead(stored);
  if (frozen) return { letterhead: frozen, live: false };
  return { letterhead: await loadLetterhead(tx), live: true };
}

/** The logo bytes for the PDF. A missing logo row means no logo; it never throws. */
export async function loadLogo(tx: PoolClient, logoId: string | null): Promise<{ bytes: Buffer; type: 'image/png' | 'image/jpeg' } | null> {
  if (!logoId) return null;
  try {
    const r = (await tx.query('select content_type, bytes from firm_logos where id = $1', [logoId])).rows[0] as { content_type: string; bytes: Buffer } | undefined;
    if (!r || !Buffer.isBuffer(r.bytes) || r.bytes.length === 0) return null;
    return { bytes: r.bytes, type: r.content_type === 'image/jpeg' ? 'image/jpeg' : 'image/png' };
  } catch {
    return null;
  }
}

/** The lines every saved email starts with: the firm name, then whichever of address, phone, email and website are filled in. */
export function letterheadLines(l: Letterhead): string[] {
  return [l.name, l.address, l.phone && `Tel: ${l.phone}`, l.email && `Email: ${l.email}`, l.website && `Web: ${l.website}`].filter((x): x is string => !!x && x.trim() !== '');
}

/** A saved email: the letterhead as plain text, the message, then the AuditOS line. */
export function emailWithLetterhead(l: Letterhead, body: string): string {
  return [...letterheadLines(l), '', body, '', 'Powered by AuditOS'].join('\n');
}
