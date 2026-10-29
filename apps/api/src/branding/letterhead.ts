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
  const r = (
    await tx.query(
      `select t.name as firm_name, bs.legal_name, bs.address, bs.kra_pin, bs.bank_details,
              fb.primary_color, fb.secondary_color, fb.logo_id, fb.phone, fb.email, fb.website, fb.footer_note
         from tenants t
         left join billing_settings bs on bs.tenant_id = t.id
         left join firm_branding fb on fb.tenant_id = t.id
        where t.id = app_tenant()`,
    )
  ).rows[0] as Record<string, string | null> | undefined;
  const primary = r?.primary_color
    ? derivePalette({ primary: r.primary_color, secondary: r.secondary_color ?? DEFAULT_BRAND.secondary }).palette.primary
    : DEFAULT_BRAND.primary;
  return {
    name: r?.legal_name || r?.firm_name || 'Audit firm',
    address: r?.address ?? null,
    phone: r?.phone ?? null,
    email: r?.email ?? null,
    website: r?.website ?? null,
    kraPin: r?.kra_pin ?? null,
    bankDetails: r?.bank_details ?? null,
    footerNote: r?.footer_note ?? null,
    primary,
    logoId: r?.logo_id ?? null,
  };
}
