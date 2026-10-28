'use client';
import { useRef } from 'react';

/** A small either/or switch (for example List and Board). Radio-group semantics with arrow-key movement. */
export function Segmented({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.id === value);
  const move = (to: number) => {
    const n = (to + options.length) % options.length;
    onChange(options[n]!.id);
    refs.current[n]?.focus();
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          tabIndex={o.id === value || (current < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
