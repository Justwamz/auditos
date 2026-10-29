'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isCurrent, navFor } from '@/lib/nav';
import { ROLE_LABELS, initialsOf } from '@/lib/text';

/** Two letters for the avatar: first and last word of a full name, or the start of an email. */
function avatarLetters(name: string): string {
  if (name.includes('@')) return initialsOf(name).slice(0, 2);
  const words = name.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[words.length - 1]![0]}` : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function Nav({ name, role, isAdmin, firm, multiFirm, brandName, logoId }: { name: string; role: string; isAdmin: boolean; firm: string; multiFirm: boolean; brandName: string | null; logoId: string | null }) {
  const path = usePathname();
  const router = useRouter();
  const groups = navFor(role, isAdmin);

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
      <a className="skip-link" href="#content">Skip to content</a>
      {brandName ? (
        <div>
          {logoId ? (
            <>
              <div className="brand-logo"><img src={`/api/branding/logo/${logoId}`} alt={brandName} /></div>
              <div className="firm">{brandName}</div>
            </>
          ) : (
            <div className="brand" style={{ color: '#fff' }}>{brandName}</div>
          )}
          <div className="powered">Powered by AuditOS</div>
        </div>
      ) : (
        <div>
          <div className="brand">AuditOS</div>
          <div className="firm">{firm}</div>
        </div>
      )}
      <nav aria-label="Main">
        {groups.map((g, n) => (
          <div className="nav-group" key={g.heading ?? `plain-${n}`} role="group" aria-label={g.heading ?? undefined}>
            {g.heading && <div className="nav-heading" aria-hidden="true">{g.heading}</div>}
            {g.items.map((i) => (
              <Link key={i.href} href={i.href} aria-current={isCurrent(i.href, path) ? 'page' : undefined}>
                {i.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="who">
        <div className="who-person">
          <span className="avatar" aria-hidden="true">{avatarLetters(name)}</span>
          <span className="who-text">
            <strong>{name}</strong>
            <span>{ROLE_LABELS[role] ?? role}</span>
          </span>
        </div>
        <div className="row">
          <button className="secondary" onClick={signOut}>Sign out</button>
          {multiFirm && <Link href="/login?select=1" style={{ color: 'var(--rail-fg, #e9f1ea)' }} className="small">Switch firm</Link>}
        </div>
      </div>
    </aside>
  );
}
