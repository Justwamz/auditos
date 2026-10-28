import Link from 'next/link';

/** Link-based tabs. `current` is the href of the tab being shown. */
export function TabBar({ tabs, current, label }: { tabs: { href: string; label: string; show: boolean }[]; current: string; label?: string }) {
  return (
    <nav className="tabbar" aria-label={label ?? 'Sections'}>
      {tabs
        .filter((t) => t.show)
        .map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.href === current ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
    </nav>
  );
}
