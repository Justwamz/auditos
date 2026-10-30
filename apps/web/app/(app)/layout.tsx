import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { MeProvider } from '@/components/Me';
import { Nav } from '@/components/Nav';
import { StepUpProvider } from '@/components/StepUp';
import { iconLinks } from '@/lib/appIcons';
import { getMe } from '@/lib/me-server';
import { themeStyle } from '@/lib/theme';

/** A firm with a logo shows it in the browser tab and on the home screen; everyone else keeps the AuditOS icon. */
export async function generateMetadata(): Promise<Metadata> {
  const me = await getMe();
  return { icons: iconLinks(me?.branding?.logoId ?? null) };
}

/** Every page in this group is checked against the API on the server before anything renders. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');
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
