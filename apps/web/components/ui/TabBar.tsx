'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

/** Link-based tabs. `current` is the href of the tab being shown. */
export function TabBar({ tabs, current, label }: { tabs: { href: string; label: string; show: boolean }[]; current: string; label?: string }) {
  const bar = useRef<HTMLElement>(null);
  // On a phone the row scrolls sideways; make sure the tab being shown is in view.
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  return (
    <nav ref={bar} className="tabbar" aria-label={label ?? 'Sections'}>
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
