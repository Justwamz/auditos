'use client';
import { groupByPerson } from '@/lib/calendar';
import { HourGrid, isAllDay, type GridColumn } from './TimeGrid';
import { personColour, type CalEvent, type Milestone } from './types';

/** One day with a column for each person who has something on it, on one shared hour grid, so clashes and free time show. */
export function PersonColumns({
  day, events, milestones, meId, onOpen,
}: {
  day: string;
  events: CalEvent[];
  milestones: Milestone[];
  meId: string;
  onOpen: (e: CalEvent) => void;
}) {
  const groups = groupByPerson(events, day, meId);
  const marks = milestones.filter((m) => m.date === day);
  if (groups.length === 0) {
    return (
      <div className="stack">
        {marks.map((m) => (
          <div key={`${m.engagementId}-${m.kind}`} className="cal-milestone"><span className="cal-diamond" aria-hidden="true" /><span>{m.title}</span></div>
        ))}
        <p className="muted">Nobody has anything planned on this day.</p>
      </div>
    );
  }
  const columns: GridColumn[] = groups.map((g) => ({
    key: g.id,
    day,
    name: g.name,
    headClass: 'cal-person-head',
    head: (
      <span className="cal-person-name">
        <span className="cal-dot" style={{ background: personColour(g.id) }} aria-hidden="true" />
        <span>{g.isMe ? `${g.name} (you)` : g.name}</span>
      </span>
    ),
    allDay: g.events.filter(isAllDay),
    timed: g.events.filter((e) => !isAllDay(e)),
  }));
  if (marks.length > 0 && columns[0]) columns[0].marks = marks;
  return <HourGrid columns={columns} onOpen={onOpen} ariaLabel="People on this day" />;
}
