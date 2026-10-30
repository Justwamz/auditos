import { AUDITOS_THEME, buildManifest } from '@/lib/appIcons';
import { getMe } from '@/lib/me-server';

export const dynamic = 'force-dynamic';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The app description. Signed in with an active firm, it carries that firm's name, colour and logo icons; anyone else
 * (signed out, the sign-in page, a failed lookup) gets the plain AuditOS app. Built from the signed-in person only.
 */
export async function GET() {
  const me = await getMe();
  const name = me?.activeTenantId && me.role ? me.memberships.find((m) => m.tenantId === me.activeTenantId)?.tenantName : undefined;
  const colour = me?.branding?.palette?.['--ledger'];
  const manifest = name
    ? buildManifest({ name, logoId: me?.branding?.logoId ?? null, themeColor: colour && HEX.test(colour) ? colour : AUDITOS_THEME })
    : buildManifest(null);
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'private, no-store' },
  });
}
