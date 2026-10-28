'use client';
import { useEffect, useState } from 'react';
import { QualityTabs } from '@/components/QualityTabs';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote } from '@/components/bits';

interface TrailEvent { seq: number; at: string; action: string; actorName: string | null; clientName: string | null; sentence: string }
interface Trail { events: TrailEvent[]; next: number | null }
interface Person { id: string; fullName: string | null; email: string }

const KINDS = [
  { id: 'all', label: 'Everything' },
  { id: 'views', label: 'Who viewed or downloaded what' },
  { id: 'changes', label: 'Changes and sign-offs' },
  { id: 'reveals', label: 'Personal details revealed' },
  { id: 'signins', label: 'Sign-ins' },
];

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AuditTrailPage() {
  const people = useApi<{ people: Person[] }>('/people');
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/clients');
  const [filters, setFilters] = useState({ kind: 'all', user: '', client: '', from: '', to: '' });
  const [events, setEvents] = useState<TrailEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);

  const query = (before?: number) => {
    const p = new URLSearchParams({ kind: filters.kind, limit: '50' });
    for (const k of ['user', 'client', 'from', 'to'] as const) if (filters[k]) p.set(k, filters[k]);
    if (before) p.set('before', String(before));
    return `/audit-trail?${p.toString()}`;
  };

  async function load(before?: number) {
    setLoading(true);
    setError(undefined);
    try {
      const r = await api.get<Trail>(query(before));
      setEvents((prev) => (before ? [...prev, ...r.events] : r.events));
      setNext(r.next);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [filters]);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>Activity history</h1><HelpLink topic="audit-trail" /></div>
        <p>Everything done on client files, in plain English: who viewed, changed, signed off, downloaded or revealed what, and when. Nothing here can be edited or deleted.</p>
      </div>
      <QualityTabs />

      <section className="sheet">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="fk">Show</label>
            <select id="fk" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fu">Person</label>
            <select id="fu" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })}>
              <option value="">Anyone</option>
              {people.data?.people.map((p) => <option key={p.id} value={p.id}>{p.fullName ?? p.email}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fc">Client</label>
            <select id="fc" value={filters.client} onChange={(e) => setFilters({ ...filters, client: e.target.value })}>
              <option value="">Any client</option>
              {clients.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="ff">From</label><input id="ff" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="ft">To</label><input id="ft" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
        </div>
      </section>

      <section className="sheet">
        <ErrorNote error={error} />
        {!loading && events.length === 0 && !error && <Empty>Nothing matches these filters.</Empty>}
        {events.length > 0 && (
          <table>
            <thead><tr><th>When</th><th>What happened</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.seq}>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td>
                  <td>{e.sentence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {next !== null && <div style={{ marginTop: '0.8rem' }}><button className="secondary" disabled={loading} onClick={() => load(next)}>Show older</button></div>}
      </section>
    </div>
  );
}
