import type { ReactNode } from 'react';

/** Lets a wide table scroll sideways inside its own box instead of widening the page. Reachable by keyboard. */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
