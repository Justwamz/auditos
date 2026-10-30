'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { visibleFocusable, trapTarget } from '@/lib/focus';
import { PHONE_QUERY, useMediaQuery } from '@/lib/media';
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
  const [logoFailed, setLogoFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const drawer = useMediaQuery(PHONE_QUERY);
  const rail = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const shown = open && drawer;

  // Navigating, or widening the window past the drawer layout, closes the menu.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!drawer) setOpen(false);
  }, [drawer]);

  useEffect(() => {
    if (!shown) {
      if (wasOpen.current) menuButton.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const el = rail.current;
    if (el) (visibleFocusable(el).find((x) => x.tagName === 'A') ?? el).focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The page behind the menu cannot be reached by keyboard or screen reader while the menu is open.
    const content = document.getElementById('content');
    content?.setAttribute('inert', '');
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !rail.current) return;
      const items = visibleFocusable(rail.current);
      const to = trapTarget(items, document.activeElement as HTMLElement | null, rail.current, e.shiftKey);
      if (to) {
        e.preventDefault();
        to.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      content?.removeAttribute('inert');
    };
  }, [shown]);

  async function signOut() {
    try {
      await api.post('/auth/logout', {});
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <>
    <div className="topbar">
      <span className="topbar-name">{brandName ?? 'AuditOS'}</span>
      <button ref={menuButton} type="button" className="menu-btn" aria-expanded={shown} aria-controls="main-menu" onClick={() => setOpen(true)}>Menu</button>
    </div>
    {shown && <div className="rail-backdrop" onClick={() => setOpen(false)} />}
    <aside
      className={shown ? 'rail is-open' : 'rail'}
      id="main-menu"
      ref={rail}
      tabIndex={-1}
      {...(shown ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Menu' } : {})}
    >
      <a className="skip-link" href="#content">Skip to content</a>
      <button type="button" className="rail-close" onClick={() => setOpen(false)}>Close menu</button>
      {brandName ? (
        <div>
          {logoId && !logoFailed ? (
            <>
              <div className="brand-logo"><img src={`/api/branding/logo/${logoId}`} alt="" height={40} onError={() => setLogoFailed(true)} /></div>
              <div className="firm">{brandName}</div>
            </>
          ) : (
            <div className="brand brand-name">{brandName}</div>
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
    </>
  );
}
