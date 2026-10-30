import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { swSource } from '@/lib/swSource';

export const dynamic = 'force-dynamic';

/** The id Next wrote for this build; the same on every start and every server of one build. */
function buildId(): string {
  try {
    return readFileSync(join(process.cwd(), process.env.NEXT_DIST_DIR ?? '.next', 'BUILD_ID'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}
const ID = buildId();

/** The worker is served from the site root and is never kept by the browser's HTTP cache. */
export function GET() {
  return new Response(swSource(ID), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
