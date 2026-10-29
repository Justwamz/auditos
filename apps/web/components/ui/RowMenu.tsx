'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean; hidden?: boolean };

const ROW = 36;
const PAD = 8;

/** A "..." button that opens a small menu of actions for one row. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const visible = items.filter((i) => !i.hidden);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  // Place the menu next to the button; flip upward when it would run off the bottom of the window.
  const place = () => {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const height = visible.length * ROW + PAD;
    const right = Math.max(8, window.innerWidth - r.right);
    const flip = r.bottom + 4 + height > window.innerHeight && r.top - 4 - height >= 0;
    setPos(flip ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const shut = () => setOpen(false);
    const follow = () => place();
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', shut);
    };
  }, [open]);

  if (visible.length === 0) return null;

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <span className="row-menu">
      <button
        ref={trigger}
        type="button"
        className="secondary row-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">...</span>
      </button>
      {open ? (
        <div ref={menu} id={id} role="menu" aria-label={label} className="row-menu-list" style={pos} onKeyDown={onMenuKey}>
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.danger ? 'row-menu-item danger' : 'row-menu-item'}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
