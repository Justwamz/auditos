import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { MeProvider } from '@/components/Me';
import { Nav } from '@/components/Nav';
import { StepUpProvider } from '@/components/StepUp';
import { resolveApiUrl } from '@/lib/apiUrl';
import { themeStyle } from '@/lib/theme';

const API_URL = resolveApiUrl();

interface Me {
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  role: string | null;
  activeTenantId: string | null;
  memberships: { tenantId: string; tenantName: string }[];
  branding?: { palette: Record<string, string>; name: string; logoId: string | null } | null;
}

/** Every page in this group is checked against the API on the server before anything renders. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const res = await fetch(`${API_URL}/me`, { headers: { cookie: jar.toString() }, cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) redirect('/login');
  const me = (await res.json()) as Me;
  if (!me.activeTenantId || !me.role) redirect('/login?select=1');
  const firm = me.memberships.find((m) => m.tenantId === me.activeTenantId)?.tenantName ?? '';

  // Only validated brand tokens reach the stylesheet (see lib/theme.ts); a firm with no saved branding gets nothing.
  const theme = themeStyle(me.branding?.palette);

  return (
    <StepUpProvider>
      {theme && <style dangerouslySetInnerHTML={{ __html: `:root { ${theme} }` }} />}
      <div className="shell">
        <Nav name={me.fullName ?? me.email} role={me.role} isAdmin={me.isAdmin} firm={firm} multiFirm={me.memberships.length > 1} brandName={me.branding?.name ?? null} logoId={me.branding?.logoId ?? null} />
        <main className="main" id="content">
          <MeProvider role={me.role} isAdmin={me.isAdmin}>{children}</MeProvider>
        </main>
      </div>
    </StepUpProvider>
  );
}
