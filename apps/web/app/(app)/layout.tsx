import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { StepUpProvider } from '@/components/StepUp';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

interface Me {
  email: string;
  role: string | null;
  activeTenantId: string | null;
  memberships: { tenantId: string; tenantName: string }[];
}

/** Every page in this group is checked against the API on the server before anything renders. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const res = await fetch(`${API_URL}/me`, { headers: { cookie: jar.toString() }, cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) redirect('/login');
  const me = (await res.json()) as Me;
  if (!me.activeTenantId || !me.role) redirect('/login?select=1');
  const firm = me.memberships.find((m) => m.tenantId === me.activeTenantId)?.tenantName ?? '';

  return (
    <StepUpProvider>
      <div className="shell">
        <Nav email={me.email} role={me.role} firm={firm} multiFirm={me.memberships.length > 1} />
        <main className="main" id="content">
          {children}
        </main>
      </div>
    </StepUpProvider>
  );
}
