'use client';
import { useId, useState, type ReactNode } from 'react';

/** A "show more" section. Controlled when `open` is given, otherwise it keeps its own state. */
export function Disclosure({
  summary,
  open,
  onToggle,
  children,
}: {
  summary: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const panel = useId();
  return (
    <div className={isOpen ? 'disclosure is-open' : 'disclosure'}>
      <button
        type="button"
        className="disclosure-btn"
        aria-expanded={isOpen}
        aria-controls={panel}
        onClick={() => {
          if (open === undefined) setOwn(!isOpen);
          onToggle?.(!isOpen);
        }}
      >
        <span className="disclosure-chevron" aria-hidden="true">›</span>
        {summary}
      </button>
      <div id={panel} className="disclosure-panel" role="region">
        <div className="disclosure-inner">{children}</div>
      </div>
    </div>
  );
}
