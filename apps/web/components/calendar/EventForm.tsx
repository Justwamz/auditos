'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dayOf, timeOf } from '@/lib/calendar';
import { ErrorNote } from '@/components/bits';
import { SidePanel } from '@/components/ui/SidePanel';
import type { CalEvent, Person } from './types';

const KINDS = [
  { id: 'meeting', label: 'Meeting' },
  { id: 'fieldwork', label: 'Fieldwork' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'leave', label: 'Leave' },
  { id: 'training', label: 'Training' },
  { id: 'other', label: 'Other' },
] as const;
const FORM = 'event-form';

const blank = (date: string) => ({ title: '', kind: 'meeting', date, allDay: false, start: '09:00', end: '10:00', location: '', clientId: '', engagementId: '', attendeeIds: [] as string[] });

/** Add or change an event, in a side panel. Times are sent as Nairobi time (+03:00). `onDone(message)` runs after a save. */
export function EventForm({
  editing, defaults, people, meId, onDone, onClose,
}: {
  editing?: CalEvent;
  defaults: { date: string };
  people: Person[];
  meId: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/clients');
  const engagements = useApi<{ engagements: { id: string; clientName: string; periodEnd: string; member: boolean }[] }>('/engagements');
  const [form, setForm] = useState(() =>
    editing
      ? {
          title: editing.title, kind: editing.kind, date: dayOf(editing.startsAt), allDay: editing.allDay, start: timeOf(editing.startsAt), end: timeOf(editing.endsAt),
          location: editing.location ?? '', clientId: editing.clientId ?? '', engagementId: editing.engagementId ?? '', attendeeIds: editing.attendees.map((a) => a.id),
        }
      : blank(defaults.date),
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    const startsAt = `${form.date}T${form.allDay ? '00:00' : form.start}:00+03:00`;
    const endsAt = `${form.date}T${form.allDay ? '23:59' : form.end}:00+03:00`;
    const body = {
      title: form.title, kind: form.kind, startsAt, endsAt, allDay: form.allDay, attendeeIds: form.attendeeIds,
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
      ...(form.clientId ? { clientId: form.clientId } : {}),
      ...(form.engagementId ? { engagementId: form.engagementId } : {}),
    };
    setBusy(true);
    try {
      if (editing) await api.patch(`/calendar/${editing.id}`, body);
      else await api.post('/calendar', body);
      onDone(editing ? 'Event updated.' : 'Event added to the calendar.');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const toggle = (id: string) => setForm({ ...form, attendeeIds: form.attendeeIds.includes(id) ? form.attendeeIds.filter((x) => x !== id) : [...form.attendeeIds, id] });

  return (
    <SidePanel
      open
      title={editing ? 'Change the event' : 'New event'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form={FORM} disabled={busy}>{editing ? 'Save changes' : 'Add to calendar'}</button>
        </>
      }
    >
      <form id={FORM} className="stack" onSubmit={save}>
        <ErrorNote error={error} />
        <div className="field"><label htmlFor="et">Title</label><input id="et" required minLength={2} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="field">
          <label htmlFor="ek">Kind</label>
          <select id="ek" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="ed">Date</label><input id="ed" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <label className="row small"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} /> All day</label>
        {!form.allDay && (
          <div className="cal-times">
            <div className="field"><label htmlFor="es">From</label><input id="es" type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
            <div className="field"><label htmlFor="ee">To</label><input id="ee" type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
          </div>
        )}
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
        <fieldset className="attendees">
          <legend className="small">Invite</legend>
          {people.filter((p) => p.id !== meId).map((p) => (
            <label key={p.id} className="row small"><input type="checkbox" checked={form.attendeeIds.includes(p.id)} onChange={() => toggle(p.id)} /> {p.fullName ?? p.email}</label>
          ))}
        </fieldset>
      </form>
    </SidePanel>
  );
}
