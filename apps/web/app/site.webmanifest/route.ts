import { buildManifest } from '@/lib/appIcons';

export const dynamic = 'force-dynamic';

/** The app description. Task 5 adds the signed-in firm; for now everyone gets the AuditOS app. */
export function GET() {
  return new Response(JSON.stringify(buildManifest(null)), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'private, no-store' },
  });
}
