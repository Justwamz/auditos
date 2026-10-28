'use client';
import { monthGrid, today } from '@/lib/calendar';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A small month for jumping to a day. */
export function MiniMonth({ anchor, selected, onPick }: { anchor: string; selected: string; onPick: (day: string) => void }) {
  const weeks = monthGrid(anchor);
  const now = today();
  const month = anchor.slice(0, 7);
  const title = `${MONTH_NAMES[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
  return (
    <div className="cal-mini" role="group" aria-label={`${title}, pick a day`}>
      <div className="cal-mini-title">{title}</div>
      <div className="cal-mini-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="cal-mini-dow" aria-hidden="true">{d}</span>)}
        {weeks.flat().map((d) => (
          <button
            key={d}
            type="button"
            className={`cal-mini-day${d.slice(0, 7) !== month ? ' is-other' : ''}${d === now ? ' is-today' : ''}${d === selected ? ' is-selected' : ''}`}
            aria-label={new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
            aria-pressed={d === selected}
            onClick={() => onPick(d)}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}
