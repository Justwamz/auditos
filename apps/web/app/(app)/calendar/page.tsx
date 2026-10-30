'use client';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { usePref } from '@/lib/prefs';
import { addDays, dayOf, eventsOnDay, KIND_STYLES, label, mondayOf, monthGrid, stepMonth, timeOf, today } from '@/lib/calendar';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { DayPanel } from '@/components/calendar/DayPanel';
import { EventForm } from '@/components/calendar/EventForm';
import { MiniMonth } from '@/components/calendar/MiniMonth';
import { MonthView } from '@/components/calendar/MonthView';
import { PersonColumns } from '@/components/calendar/PersonColumns';
import { TimeGrid } from '@/components/calendar/TimeGrid';
import type { CalEvent, Milestone, Person } from '@/components/calendar/types';
import { PageHead } from '@/components/ui/PageHead';
import { Segmented } from '@/components/ui/Segmented';
import { SidePanel } from '@/components/ui/SidePanel';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const VIEWS = [
  { id: 'day', label: 'Day' },
  { id: 'workweek', label: 'Work week' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
] as const;
type View = (typeof VIEWS)[number]['id'];
const STEP_NOUN: Record<View, string> = { day: 'day', workweek: 'week', week: 'week', month: 'month' };
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (d: string) => `${Number(d.slice(8))} ${SHORT_MONTH[Number(d.slice(5, 7)) - 1]}`;

/** The days on screen for a view. The API range is the first to the last of these. */
function visibleDays(view: View, anchor: string): string[] {
  if (view === 'month') return monthGrid(anchor).flat();
  if (view === 'day') return [anchor];
  const monday = mondayOf(anchor);
  return Array.from({ length: view === 'workweek' ? 5 : 7 }, (_, i) => addDays(monday, i));
}

export default function CalendarPage() {
  const [savedView, setView] = usePref<string>('calendar.view', 'month');
  // A saved value that is not one of the four views falls back to the month.
  const view: View = VIEWS.find((v) => v.id === savedView)?.id ?? 'month';
  const [byPerson, setByPerson] = useState(false);
  const [selected, setSelected] = useState(() => today());
  const [anchor, setAnchor] = useState(() => today());
  const [person, setPerson] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  // Work week asks for the whole week so weekend events can be counted, even though only Monday to Friday are drawn.
  const reach = view === 'workweek' ? addDays(from, 6) : to;
  const cal = useApi<{ events: CalEvent[]; milestones: Milestone[] }>(`/calendar?from=${from}&to=${reach}${person ? `&person=${person}` : ''}`);
  const me = useApi<{ userId: string; role: string; isAdmin: boolean }>('/me');
  const people = useApi<{ people: Person[] }>('/people');
  const [panel, setPanel] = useState<{ editing?: CalEvent } | null>(null);
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');

  const sees = me.data?.role === 'partner' || me.data?.role === 'manager';
  const showPeople = sees && byPerson && view === 'day';
  const canSchedule = me.data !== undefined && me.data.role !== 'firm_admin';
  const meId = me.data?.userId ?? '';
  const events = useMemo(() => (cal.data?.events ?? []).filter((e) => !hidden.includes(e.kind)), [cal.data, hidden]);
  /** On a phone the day's details sit below the month, so bring them into view after a day is chosen. */
  function pickDay(day: string) {
    setSelected(day);
    if (!window.matchMedia('(max-width: 40rem)').matches) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => document.querySelector('.cal-panel')?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }));
  }

  const hiddenCount = eventsOnDay(cal.data?.events ?? [], selected).length - eventsOnDay(events, selected).length;
  const milestones = cal.data?.milestones ?? [];

  function go(day: string) {
    setSelected(day);
    setAnchor(day);
  }
  const step = (n: number) => go(view === 'month' ? stepMonth(anchor, n, today()) : addDays(anchor, (view === 'day' ? 1 : 7) * n));
  const choose = (id: string) => { setByPerson(false); setView(id); };
  const togglePeople = () => {
    if (!byPerson) setView('day');
    setByPerson(!byPerson);
  };

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
  const title =
    view === 'month' ? `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`
    : view === 'day' ? new Date(`${anchor}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${short(from)} to ${short(to)} ${to.slice(0, 4)}`;
  const noun = STEP_NOUN[view];
  const weekend = view === 'workweek' && !showPeople
    ? new Set([...eventsOnDay(events, addDays(from, 5)), ...eventsOnDay(events, addDays(from, 6))].map((e) => e.id)).size
    : 0;

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
          <button type="button" className="secondary cal-step" aria-label={`Previous ${noun}`} onClick={() => step(-1)}><span aria-hidden="true">‹</span></button>
          <button type="button" className="secondary cal-step" aria-label={`Next ${noun}`} onClick={() => step(1)}><span aria-hidden="true">›</span></button>
          <h2 className="cal-month-title">{title}</h2>
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
          {sees && (
            <button type="button" className="chip" aria-pressed={showPeople} onClick={togglePeople}>{showPeople && <span className="chip-check" aria-hidden="true">✓ </span>}See by person</button>
          )}
          <Segmented label="How to show the calendar" value={view} onChange={choose} options={VIEWS.map((v) => ({ id: v.id, label: v.label }))} />
        </div>
      </div>

      {weekend > 0 && (
        <p className="cal-hint" role="status">
          <span>{weekend} {weekend === 1 ? 'event' : 'events'} on the weekend. Switch to Week to see {weekend === 1 ? 'it' : 'them'}.</span>
          <button type="button" className="secondary" onClick={() => choose('week')}>Show the whole week</button>
        </p>
      )}

      <div className={`cal-layout${view === 'month' ? '' : ' is-wide'}`}>
        <div className="cal-side">
          <section className="sheet cal-mini-sheet">
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
        <section className="sheet cal-main" aria-label={showPeople ? 'People on this day' : `${VIEWS.find((v) => v.id === view)!.label} calendar`}>
          {view === 'month' && <MonthView days={grid} month={month} events={events} milestones={milestones} selected={selected} onSelect={pickDay} meId={meId} />}
          {view !== 'month' && !showPeople && (
            <TimeGrid days={days} events={events} milestones={milestones} meId={meId} onOpen={setDetail} onOpenDay={days.length > 1 ? (d) => { go(d); choose('day'); } : undefined} />
          )}
          {showPeople && <PersonColumns day={anchor} events={events} milestones={milestones} meId={meId} onOpen={setDetail} />}
        </section>
        {view === 'month' && (
          <DayPanel
            day={selected}
            events={events}
            milestones={milestones}
            meId={meId}
            hiddenCount={hiddenCount}
            onEdit={(e) => { setDone(''); setPanel({ editing: e }); }}
            onCancel={(e) => void cancel(e)}
          />
        )}
      </div>

      <SidePanel
        open={detail !== null}
        title={detail?.title ?? ''}
        onClose={() => setDetail(null)}
        footer={detail?.mine ? (
          <>
            <button type="button" className="danger" onClick={() => { const e = detail; setDetail(null); void cancel(e); }}>Cancel event</button>
            <button type="button" onClick={() => { const e = detail; setDetail(null); setDone(''); setPanel({ editing: e }); }}>Edit</button>
          </>
        ) : undefined}
      >
        {detail && <EventDetail event={detail} />}
      </SidePanel>

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

function EventDetail({ event: e }: { event: CalEvent }) {
  const k = KIND_STYLES[e.kind] ?? KIND_STYLES.other!;
  const who = e.attendees.length > 0 ? ` with ${e.attendees.map((a) => a.name).join(', ')}` : '';
  const when = e.allDay ? 'all day' : e.startsAt === e.endsAt ? timeOf(e.startsAt) : `${timeOf(e.startsAt)} to ${timeOf(e.endsAt)}`;
  return (
    <div className="stack cal-detail">
      <div><span aria-hidden="true">{k.icon} </span>{k.label}</div>
      <div>{label(dayOf(e.startsAt))}, {when}</div>
      {e.location && <div>Where: {e.location}</div>}
      {e.clientName && <div>Client: {e.clientName}</div>}
      <div className="muted">{e.createdByName}{who}</div>
      {e.notes && <div>{e.notes}</div>}
    </div>
  );
}
