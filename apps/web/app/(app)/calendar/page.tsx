'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';

interface CalEvent {
  id: string; title: string; kind: string; startsAt: string; endsAt: string; allDay: boolean; location: string | null; notes: string | null;
  clientId: string | null; clientName: string | null; engagementId: string | null; attendees: { id: string; name: string }[]; createdByName: string; mine: boolean;
}
interface Milestone { date: string; title: string; engagementId: string; kind: string }
interface Person { id: string; fullName: string | null; email: string; role: string }

const TZ = 'Africa/Nairobi';
const KINDS = [
  { id: 'meeting', label: 'Meeting' },
  { id: 'fieldwork', label: 'Fieldwork' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'leave', label: 'Leave' },
  { id: 'training', label: 'Training' },
  { id: 'other', label: 'Other' },
] as const;

const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
};
const label = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const today = () => dayOf(new Date().toISOString());

const blank = (date: string) => ({ title: '', kind: 'meeting', date, allDay: false, start: '09:00', end: '10:00', location: '', clientId: '', engagementId: '', attendeeIds: [] as string[] });

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(today()));
  const [person, setPerson] = useState('');
  const weekEnd = addDays(weekStart, 6);
  const cal = useApi<{ events: CalEvent[]; milestones: Milestone[] }>(`/calendar?from=${weekStart}&to=${weekEnd}${person ? `&person=${person}` : ''}`);
  const me = useApi<{ userId: string; role: string; isAdmin: boolean }>('/me');
  const people = useApi<{ people: Person[] }>('/people');
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/clients');
  const engagements = useApi<{ engagements: { id: string; clientName: string; periodEnd: string; member: boolean }[] }>('/engagements');
  const [form, setForm] = useState(() => blank(today()));
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');

  const sees = me.data?.role === 'partner' || me.data?.role === 'manager';
  const canSchedule = me.data?.role !== 'firm_admin';
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const events = cal.data?.events ?? [];

  const onDay = (d: string) =>
    events.filter((e) => {
      const first = dayOf(e.startsAt);
      const last = dayOf(e.endsAt);
      return d >= first && d <= last;
    });

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setDone('');
    const startsAt = `${form.date}T${form.allDay ? '00:00' : form.start}:00+03:00`;
    const endsAt = `${form.date}T${form.allDay ? '23:59' : form.end}:00+03:00`;
    const body = {
      title: form.title, kind: form.kind, startsAt, endsAt, allDay: form.allDay, attendeeIds: form.attendeeIds,
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
      ...(form.clientId ? { clientId: form.clientId } : {}),
      ...(form.engagementId ? { engagementId: form.engagementId } : {}),
    };
    try {
      if (editing) await api.patch(`/calendar/${editing}`, body);
      else await api.post('/calendar', body);
      setDone(editing ? 'Event updated.' : 'Event added to the calendar.');
      setEditing(null);
      setForm(blank(form.date));
      cal.reload();
    } catch (e) {
      setError(e);
    }
  }

  async function cancel(id: string) {
    setError(undefined);
    try {
      await api.post(`/calendar/${id}/cancel`, {});
      cal.reload();
    } catch (e) {
      setError(e);
    }
  }

  function edit(e: CalEvent) {
    setEditing(e.id);
    setForm({
      title: e.title, kind: e.kind, date: dayOf(e.startsAt), allDay: e.allDay, start: timeOf(e.startsAt), end: timeOf(e.endsAt),
      location: e.location ?? '', clientId: e.clientId ?? '', engagementId: e.engagementId ?? '', attendeeIds: e.attendees.map((a) => a.id),
    });
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  const toggle = (id: string) => setForm({ ...form, attendeeIds: form.attendeeIds.includes(id) ? form.attendeeIds.filter((x) => x !== id) : [...form.attendeeIds, id] });

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>Calendar</h1><HelpLink topic="calendar" /></div>
        <p>
          {sees ? 'What the firm is doing this week: your own events, and those of the people on your teams. ' : 'Your own events and those of your engagements. '}
          Year ends, report dates and file-lock deadlines appear by themselves.
        </p>
      </div>
      <ErrorNote error={error ?? cal.error} />

      <section className="sheet row between">
        <div className="row">
          <button className="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">Previous week</button>
          <button className="secondary" onClick={() => setWeekStart(mondayOf(today()))}>This week</button>
          <button className="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">Next week</button>
          <strong>{label(weekStart)} to {label(weekEnd)}</strong>
        </div>
        {sees && (
          <div className="row">
            <label htmlFor="cp" className="small">Show</label>
            <select id="cp" value={person} onChange={(e) => setPerson(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Everyone I can see</option>
              {people.data?.people.map((p) => <option key={p.id} value={p.id}>{p.fullName ?? p.email}</option>)}
            </select>
          </div>
        )}
      </section>

      <div className="week" role="list" aria-label="This week">
        {days.map((d) => (
          <section key={d} className={`day${d === today() ? ' today' : ''}`} role="listitem" aria-label={label(d)}>
            <h3>{label(d)}</h3>
            {(cal.data?.milestones ?? []).filter((m) => m.date === d).map((m) => <div key={`${m.engagementId}-${m.kind}`} className="milestone">◆ {m.title}</div>)}
            {onDay(d).map((e) => (
              <div key={`${e.id}-${d}`} className={`event kind-${e.kind}`}>
                <div className="small muted">{e.allDay ? 'All day' : `${timeOf(e.startsAt)} to ${timeOf(e.endsAt)}`}</div>
                <strong>{e.title}</strong>
                <div className="small">{[e.clientName, e.location].filter(Boolean).join(' · ')}</div>
                <div className="small muted">{e.createdByName}{e.attendees.length > 0 ? ` with ${e.attendees.map((a) => a.name).join(', ')}` : ''}</div>
                {e.mine && (
                  <div className="row">
                    <button className="quiet" onClick={() => edit(e)}>Edit</button>
                    <button className="quiet" onClick={() => cancel(e.id)}>Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>

      {canSchedule && (
        <form className="sheet stack" onSubmit={save}>
          <h2>{editing ? 'Change the event' : 'Add an event'}</h2>
          <div className="form-grid">
            <div className="field"><label htmlFor="et">Title</label><input id="et" required minLength={2} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="ek">Kind</label>
              <select id="ek" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="ed">Date</label><input id="ed" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            {!form.allDay && <div className="field"><label htmlFor="es">From</label><input id="es" type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>}
            {!form.allDay && <div className="field"><label htmlFor="ee">To</label><input id="ee" type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>}
            <div className="field"><label htmlFor="el">Where</label><input id="el" maxLength={200} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="ec">Client</label>
              <select id="ec" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">None</option>
                {clients.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="eg">Engagement</label>
              <select id="eg" value={form.engagementId} onChange={(e) => setForm({ ...form, engagementId: e.target.value })}>
                <option value="">None</option>
                {engagements.data?.engagements.filter((g) => g.member).map((g) => <option key={g.id} value={g.id}>{g.clientName}, year ended {g.periodEnd}</option>)}
              </select>
            </div>
          </div>
          <label className="row small"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} /> All day</label>
          <fieldset className="attendees">
            <legend className="small">Invite</legend>
            {people.data?.people.filter((p) => p.id !== me.data?.userId).map((p) => (
              <label key={p.id} className="row small"><input type="checkbox" checked={form.attendeeIds.includes(p.id)} onChange={() => toggle(p.id)} /> {p.fullName ?? p.email}</label>
            ))}
          </fieldset>
          {done && <Notice>{done}</Notice>}
          <div className="row">
            <button>{editing ? 'Save changes' : 'Add to calendar'}</button>
            {editing && <button type="button" className="quiet" onClick={() => { setEditing(null); setForm(blank(form.date)); }}>Stop editing</button>}
          </div>
        </form>
      )}
    </div>
  );
}
