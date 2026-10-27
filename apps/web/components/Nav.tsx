'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/text';

export function Nav({ name, role, isAdmin, firm, multiFirm }: { name: string; role: string; isAdmin: boolean; firm: string; multiFirm: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const admin = role === 'firm_admin';
  const holdsAdmin = admin || isAdmin;
  const seesTrail = holdsAdmin || role === 'manager' || role === 'partner';
  const works = ['partner', 'manager', 'senior', 'staff'].includes(role);
  const billing = role === 'partner' || role === 'manager' || holdsAdmin;
  const items: { href: string; label: string; show: boolean }[] = [
    { href: '/', label: 'Dashboard', show: !admin },
    { href: '/engagements', label: 'Engagements', show: !admin },
    { href: '/clients', label: 'Clients', show: true },
    { href: '/pipeline', label: 'Pipeline', show: works },
    { href: '/calendar', label: 'Calendar', show: !admin },
    { href: '/timesheet', label: 'Timesheet', show: !admin },
    { href: '/billing', label: 'Billing', show: billing },
    { href: '/invoices', label: 'Invoices', show: billing },
    { href: '/quotes', label: 'Quotations', show: billing },
    { href: '/independence', label: 'Independence', show: !admin },
    { href: '/audit-trail', label: 'Audit trail', show: seesTrail },
    { href: '/admin/users', label: 'People and access', show: holdsAdmin },
    { href: '/help', label: 'Help', show: true },
  ];
  const current = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

  async function signOut() {
    try {
      await api.post('/auth/logout', {});
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <aside className="rail">
      <div>
        <div className="brand">AuditOS</div>
        <div className="firm">{firm}</div>
      </div>
      <nav aria-label="Main">
        {items.filter((i) => i.show).map((i) => (
          <Link key={i.href} href={i.href} aria-current={current(i.href) ? 'page' : undefined}>
            {i.label}
          </Link>
        ))}
      </nav>
      <div className="who">
        <strong>{name}</strong>
        {ROLE_LABELS[role] ?? role}
        <div className="row">
          <button className="secondary" style={{ color: '#e9f1ea', borderColor: '#7fa38c' }} onClick={signOut}>Sign out</button>
          {multiFirm && <Link href="/login?select=1" style={{ color: '#e9f1ea' }} className="small">Switch firm</Link>}
        </div>
      </div>
    </aside>
  );
}
