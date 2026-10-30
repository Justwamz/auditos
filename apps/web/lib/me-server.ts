import { cache } from 'react';
import { cookies } from 'next/headers';
import { resolveApiUrl } from '@/lib/apiUrl';

export interface Me {
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  role: string | null;
  activeTenantId: string | null;
  memberships: { tenantId: string; tenantName: string }[];
  branding?: { palette: Record<string, string>; name: string; logoId: string | null } | null;
}

/** The signed-in person, read once per request (the page and its head share the answer). Null when not signed in. */
export const getMe = cache(async (): Promise<Me | null> => {
  const jar = await cookies();
  const res = await fetch(`${resolveApiUrl()}/me`, { headers: { cookie: jar.toString() }, cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as Me | null;
});
