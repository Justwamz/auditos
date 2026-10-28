'use client';

export type ChipOption = { id: string; label: string; count?: number; hint?: string };

/** Filter chips: one is selected at a time. Selected is shown by fill, border and a check mark. */
export function Chips({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  options: ChipOption[];
  label?: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" className="chip" aria-pressed={on} title={o.hint} onClick={() => onChange(o.id)}>
            {on ? <span className="chip-check" aria-hidden="true">✓</span> : null}
            {o.label}
            {o.count !== undefined ? <span className="chip-count">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
