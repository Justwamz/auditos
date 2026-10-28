'use client';
import { useState } from 'react';
import { Disclosure } from '@/components/ui/Disclosure';
import { groupByPerson, KIND_STYLES, timeOf } from '@/lib/calendar';
import { personColour, type CalEvent, type Milestone } from './types';

/** One day, grouped by person. The signed-in person is open, the others are folded. */
export function DayPanel({
  day, events, milestones, meId, hiddenCount = 0, onEdit, onCancel,
}: {
  day: string;
  events: CalEvent[];
  milestones: Milestone[];
  meId: string;
  /** Events on this day that the kind filter is hiding. */
  hiddenCount?: number;
  onEdit: (e: CalEvent) => void;
  onCancel: (e: CalEvent) => void;
}) {
  const groups = groupByPerson(events, day, meId);
  const marks = milestones.filter((m) => m.date === day);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  return (
    <aside className="cal-panel sheet" aria-label="Day details">
      <h2 className="cal-panel-title">{new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</h2>
      {marks.length > 0 && (
        <ul className="cal-milestones">
          {marks.map((m) => (
            <li key={`${m.engagementId}-${m.kind}`} className="cal-milestone">
              <span className="cal-diamond" aria-hidden="true" />
              <span>{m.title}</span>
            </li>
          ))}
        </ul>
      )}
      {groups.length === 0 && marks.length === 0 && (
        <p className="muted">{hiddenCount > 0 ? "Everything on this day is hidden by your filters. Show all kinds to see it." : "Nothing planned for this day."}</p>
      )}
      {groups.map((g) => {
        const key = `${day}:${g.id}`;
        return (
          <div key={g.id} className="cal-person">
            <Disclosure
              open={opened[key] ?? g.isMe}
              onToggle={(o) => setOpened({ ...opened, [key]: o })}
              summary={
                <span className="cal-person-sum">
                  <span className="cal-dot" style={{ background: personColour(g.id) }} aria-hidden="true" />
                  <span>{g.isMe ? `${g.name} (you)` : g.name}</span>
                  <span className="muted small">{g.events.length} {g.events.length === 1 ? 'event' : 'events'}</span>
                </span>
              }
            >
              <div className="cal-events">
                {g.events.map((e) => {
                  const k = KIND_STYLES[e.kind] ?? KIND_STYLES.other!;
                  const who = e.attendees.length > 0 ? ` with ${e.attendees.map((a) => a.name).join(', ')}` : '';
                  return (
                    <div key={e.id} className="cal-event" style={{ borderLeftColor: `var(${k.token})` }}>
                      <Disclosure
                        summary={
                          <span className="cal-event-sum">
                            <span className="small muted">{e.allDay ? 'All day' : `${timeOf(e.startsAt)} to ${timeOf(e.endsAt)}`}</span>
                            <span>{e.title}</span>
                            <span className="small muted"><span aria-hidden="true">{k.icon} </span>{k.label}</span>
                          </span>
                        }
                      >
                        <div className="cal-event-more small">
                          <div><span aria-hidden="true">{k.icon} </span>{k.label}</div>
                          {e.location && <div>Where: {e.location}</div>}
                          {e.clientName && <div>Client: {e.clientName}</div>}
                          <div className="muted">{e.createdByName}{who}</div>
                          {e.notes && <div>{e.notes}</div>}
                          {e.mine && (
                            <div className="row">
                              <button type="button" className="secondary" onClick={() => onEdit(e)}>Edit</button>
                              <button type="button" className="danger" onClick={() => onCancel(e)}>Cancel event</button>
                            </div>
                          )}
                        </div>
                      </Disclosure>
                    </div>
                  );
                })}
              </div>
            </Disclosure>
          </div>
        );
      })}
    </aside>
  );
}
