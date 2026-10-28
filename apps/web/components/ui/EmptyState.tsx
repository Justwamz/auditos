import type { CSSProperties, ReactNode } from 'react';

export type EmptyKind = 'ledger' | 'calendar' | 'people' | 'folder';

const ART: Record<EmptyKind, ReactNode> = {
  ledger: (
    <>
      <path d="M22 18h22a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H22z" />
      <path d="M22 18v32M17 22v24a3 3 0 0 0 3 3h2" />
      <path d="M29 27h12M29 33h12M29 39h7" />
    </>
  ),
  calendar: (
    <>
      <rect x="15" y="20" width="34" height="29" rx="4" />
      <path d="M15 29h34M24 15v8M40 15v8" />
      <path d="M24 36h4M32 36h4M40 36h2M24 42h4M32 42h4" />
    </>
  ),
  people: (
    <>
      <circle cx="32" cy="26" r="7" />
      <path d="M18 49c0-8 6-13 14-13s14 5 14 13" />
    </>
  ),
  folder: (
    <>
      <path d="M14 22a3 3 0 0 1 3-3h10l5 6h15a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z" />
      <path d="M14 31h36" />
    </>
  ),
};

/** Friendly "nothing here yet": a small line picture, one plain sentence and, at most, one next step. */
export function EmptyState({ title, children, action, kind = 'ledger' }: { title?: string; children?: ReactNode; action?: ReactNode; kind?: EmptyKind }) {
  return (
    <div className="empty-state">
      <svg className="empty-art" viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="32" cy="32" r="31" className="empty-wash" stroke="none" />
        {ART[kind]}
      </svg>
      {title ? <h2>{title}</h2> : null}
      {children ? <p>{children}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/** A placeholder block with a slow shimmer, used while something loads. */
export function Skeleton({ width, height = 16, className }: { width?: number | string; height?: number | string; className?: string }) {
  const style: CSSProperties = { width, height };
  return <span className={className ? `skeleton ${className}` : 'skeleton'} style={style} aria-hidden="true" />;
}
