'use client';
import { eventsOnDay, label, peopleOf, today } from '@/lib/calendar';
import { personColour, type CalEvent, type Milestone } from './types';

const MAX_DOTS = 6;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The month as a grid of days. Each day says how many events it has and shows a dot for each person (at most six). */
export function MonthView({
  days, month, events, milestones, selected, onSelect, meId,
}: {
  days: string[][];
  month: string;
  events: CalEvent[];
  milestones: Milestone[];
  selected: string;
  onSelect: (day: string) => void;
  meId: string;
}) {
  const now = today();
  return (
    <div className="cal-month" role="group" aria-label="Month">
      {WEEKDAYS.map((w) => <div key={w} className="cal-weekday" aria-hidden="true">{w}</div>)}
      {days.flat().map((d) => {
        const here = eventsOnDay(events, d);
        const marks = milestones.filter((m) => m.date === d);
        const people = [...new Map(here.flatMap(peopleOf).map((p) => [p.id, p])).values()].sort(
          (a, b) => Number(b.id === meId) - Number(a.id === meId) || a.name.localeCompare(b.name),
        );
        const count = `${here.length} ${here.length === 1 ? 'event' : 'events'}`;
        const cls = ['cal-cell', d.slice(0, 7) !== month ? 'is-other' : '', d === now ? 'is-today' : '', d === selected ? 'is-selected' : ''].filter(Boolean).join(' ');
        return (
          <button
            key={d}
            type="button"
            data-day={d}
            className={cls}
            aria-pressed={d === selected}
            aria-current={d === now ? 'date' : undefined}
            aria-label={`${label(d)}${here.length ? `, ${count}` : ''}${marks.length ? `, ${marks.length === 1 ? '1 date' : `${marks.length} dates`}` : ''}`}
            onClick={() => onSelect(d)}
          >
            <span className="cal-num">{Number(d.slice(8))}</span>
            {marks.length > 0 && <span className="cal-diamond cal-diamond-cell" aria-hidden="true" />}
            {here.length > 0 && <span className="cal-count">{count}</span>}
            {people.length > 0 && (
              <span className="cal-dots">
                {people.slice(0, MAX_DOTS).map((p) => (
                  <span key={p.id} className="cal-dot" role="img" title={p.name} aria-label={p.name} style={{ background: personColour(p.id) }} />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
