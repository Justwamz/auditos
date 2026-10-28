'use client';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { usePref } from '@/lib/prefs';
import { eventsOnDay, KIND_STYLES, monthGrid, stepMonth, today } from '@/lib/calendar';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { DayPanel } from '@/components/calendar/DayPanel';
import { EventForm } from '@/components/calendar/EventForm';
import { MiniMonth } from '@/components/calendar/MiniMonth';
import { MonthView } from '@/components/calendar/MonthView';
import type { CalEvent, Milestone, Person } from '@/components/calendar/types';
import { PageHead } from '@/components/ui/PageHead';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Only the month is ready. The other three are shown so people can see what is coming, but they cannot be chosen yet.
const VIEWS = [
  { id: 'day', label: 'Day', ready: false },
  { id: 'workweek', label: 'Work week', ready: false },
  { id: 'week', label: 'Week', ready: false },
  { id: 'month', label: 'Month', ready: true },
];

export default function CalendarPage() {
  const [, setView] = usePref<string>('calendar.view', 'month');
  const [selected, setSelected] = useState(() => today());
  const [anchor, setAnchor] = useState(() => today());
  const [person, setPerson] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const from = grid[0]![0]!;
  const to = grid[grid.length - 1]![6]!;
  const cal = useApi<{ events: CalEvent[]; milestones: Milestone[] }>(`/calendar?from=${from}&to=${to}${person ? `&person=${person}` : ''}`);
  const me = useApi<{ userId: string; role: string; isAdmin: boolean }>('/me');
  const people = useApi<{ people: Person[] }>('/people');
  const [panel, setPanel] = useState<{ editing?: CalEvent } | null>(null);
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');

  const sees = me.data?.role === 'partner' || me.data?.role === 'manager';
  const canSchedule = me.data !== undefined && me.data.role !== 'firm_admin';
  const meId = me.data?.userId ?? '';
  const events = useMemo(() => (cal.data?.events ?? []).filter((e) => !hidden.includes(e.kind)), [cal.data, hidden]);
  const hiddenCount = eventsOnDay(cal.data?.events ?? [], selected).length - eventsOnDay(events, selected).length;
  const milestones = cal.data?.milestones ?? [];

  function go(day: string) {
    setSelected(day);
    setAnchor(day);
  }
  const step = (n: number) => go(stepMonth(anchor, n, today()));

  async function cancel(e: CalEvent) {
    setError(undefined);
    setDone('');
    try {
      await api.post(`/calendar/${e.id}/cancel`, {});
      setDone(`${e.title} cancelled.`);
      cal.reload();
    } catch (err) {
      setError(err);
    }
  }

  const addButton = canSchedule ? <button type="button" onClick={() => { setDone(''); setPanel({}); }}>+ New event</button> : undefined;
  const month = anchor.slice(0, 7);

  return (
    <div className="stack-lg">
      <PageHead
        title="Calendar"
        sentence={sees ? "Your own events and your teams' events, with year ends and report dates added for you." : "Your own events and your engagements' events, with year ends and report dates added for you."}
        action={addButton}
        help={<HelpLink topic="calendar" />}
      />
      <ErrorNote error={error ?? cal.error} />
      {done && <Notice>{done}</Notice>}

      <div className="cal-toolbar">
        <div className="row">
          <button type="button" className="secondary" onClick={() => go(today())}>Today</button>
          <button type="button" className="secondary cal-step" aria-label="Previous month" onClick={() => step(-1)}><span aria-hidden="true">‹</span></button>
          <button type="button" className="secondary cal-step" aria-label="Next month" onClick={() => step(1)}><span aria-hidden="true">›</span></button>
          <h2 className="cal-month-title">{MONTH_NAMES[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</h2>
        </div>
        <div className="row">
          {sees && (
            <div className="row">
              <label htmlFor="cp" className="small">Show</label>
              <select id="cp" value={person} onChange={(e) => setPerson(e.target.value)} style={{ width: 'auto' }}>
                <option value="">Everyone I can see</option>
                {people.data?.people.map((p) => <option key={p.id} value={p.id}>{p.fullName ?? p.email}</option>)}
              </select>
            </div>
          )}
          <div className="segmented cal-views" role="radiogroup" aria-label="How to show the calendar">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={v.id === 'month'}
                disabled={!v.ready}
                title={v.ready ? undefined : 'Not ready yet'}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-layout">
        <div className="cal-side">
          <section className="sheet">
            <MiniMonth anchor={anchor} selected={selected} onPick={go} />
          </section>
          <section className="sheet cal-legend" aria-label="What to show">
            <h3>What to show</h3>
            <div className="chips">
              {Object.entries(KIND_STYLES).map(([id, k]) => {
                const on = !hidden.includes(id);
                return (
                  <button key={id} type="button" className="chip" aria-pressed={on} onClick={() => setHidden(on ? [...hidden, id] : hidden.filter((x) => x !== id))}>
                    <span className="cal-swatch" style={{ background: `var(${k.token})` }} aria-hidden="true" />
                    {k.label}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
        <section className="sheet cal-main" aria-label="Month calendar">
          <MonthView days={grid} month={month} events={events} milestones={milestones} selected={selected} onSelect={setSelected} meId={meId} />
        </section>
        <DayPanel
          day={selected}
          events={events}
          milestones={milestones}
          meId={meId}
          hiddenCount={hiddenCount}
          onEdit={(e) => { setDone(''); setPanel({ editing: e }); }}
          onCancel={(e) => void cancel(e)}
        />
      </div>

      {panel && me.data && (
        <EventForm
          editing={panel.editing}
          defaults={{ date: selected }}
          people={people.data?.people ?? []}
          meId={meId}
          onClose={() => setPanel(null)}
          onDone={(message) => { setPanel(null); setDone(message); cal.reload(); }}
        />
      )}
    </div>
  );
}
