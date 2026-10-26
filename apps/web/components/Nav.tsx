'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/text';

export function Nav({ email, role, firm, multiFirm }: { email: string; role: string; firm: string; multiFirm: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const admin = role === 'firm_admin';
  const canManage = role === 'manager' || role === 'partner';
  const items: { href: string; label: string; show: boolean }[] = [
    { href: '/', label: 'Dashboard', show: !admin },
    { href: '/engagements', label: 'Engagements', show: !admin },
    { href: '/clients', label: 'Clients', show: canManage },
    { href: '/independence', label: 'Independence', show: !admin },
    { href: '/admin/users', label: 'People and access', show: admin },
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
        <strong>{email}</strong>
        {ROLE_LABELS[role] ?? role}
        <div className="row">
          <button className="secondary" style={{ color: '#e9f1ea', borderColor: '#7fa38c' }} onClick={signOut}>Sign out</button>
          {multiFirm && <Link href="/login?select=1" style={{ color: '#e9f1ea' }} className="small">Switch firm</Link>}
        </div>
      </div>
    </aside>
  );
}
