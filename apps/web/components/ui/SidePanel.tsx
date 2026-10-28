'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { trapTarget, visibleFocusable } from '@/lib/focus';

/** Right-hand dialog. Focus moves in when it opens and returns to the opener when it closes. */
export function SidePanel({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = panel.current?.querySelector<HTMLElement>('.side-panel-body');
    const control = body ? visibleFocusable(body).find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) : undefined;
    const first = control ?? (panel.current ? visibleFocusable(panel.current)[0] : undefined);
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = visibleFocusable(panel.current);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const to = trapTarget(items, active, panel.current, e.shiftKey);
      if (items.length === 0) e.preventDefault();
      if (to) {
        e.preventDefault();
        to.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} className="side-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="side-panel-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="quiet icon-close" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="side-panel-body">{children}</div>
        {footer ? <div className="side-panel-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
