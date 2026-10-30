import type { ReactNode } from 'react';

/**
 * A table cell that, on a phone, shows its column heading in front of its value ("Sector: Trading").
 * The heading is real text (not CSS-generated) so screen readers read it; wide screens hide it because the column heading says it already.
 * Put role="table", "rowgroup", "row" and "columnheader" on the table, row groups, rows and headings of a stacked table so they keep their meaning when CSS changes how they are laid out.
 */
export function StackCell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <td role="cell" className={className} data-label={label}>
      {label ? <span className="stack-label">{label}</span> : null}
      {children}
    </td>
  );
}
