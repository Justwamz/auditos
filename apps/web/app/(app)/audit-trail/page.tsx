'use client';
import { useEffect, useMemo, useState } from 'react';
import { QualityTabs } from '@/components/QualityTabs';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { matchesQuery } from '@/lib/text-match';
import { ErrorNote } from '@/components/bits';
import { Chips } from '@/components/ui/Chips';
import { Disclosure } from '@/components/ui/Disclosure';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';

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
const NO_FILTERS = { kind: 'all', user: '', client: '', from: '', to: '' };

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AuditTrailPage() {
  const people = useApi<{ people: Person[] }>('/people');
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/clients');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [query, setQuery] = useState('');
  const [more, setMore] = useState(false);
  const [events, setEvents] = useState<TrailEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);

  const buildQuery = (before?: number) => {
    const p = new URLSearchParams({ kind: filters.kind, limit: '50' });
    for (const k of ['user', 'client', 'from', 'to'] as const) if (filters[k]) p.set(k, filters[k]);
    if (before) p.set('before', String(before));
    return `/audit-trail?${p.toString()}`;
  };

  async function load(before?: number) {
    setLoading(true);
    setError(undefined);
    try {
      const r = await api.get<Trail>(buildQuery(before));
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

  const rows = useMemo(() => events.filter((e) => matchesQuery(query, e.sentence, e.actorName, e.clientName)), [events, query]);
  const narrowed = query.trim() !== '' || JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const first = loading && events.length === 0;

  function reset() {
    setQuery('');
    setFilters(NO_FILTERS);
  }

  return (
    <div className="stack-lg">
      <PageHead
        title="Activity history"
        sentence="Who did what on client files, and when, in plain English. Nothing here can be edited or deleted."
        help={<HelpLink topic="audit-trail" />}
      />
      <QualityTabs />

      <div className="prospects-toolbar">
        <input type="search" className="prospects-search" aria-label="Search activity" placeholder="Search by person, client or what happened" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Chips
          label="Type of activity"
          value={filters.kind}
          onChange={(kind) => setFilters({ ...filters, kind })}
          options={KINDS}
        />
      </div>

      <Disclosure summary="More filters" open={more} onToggle={setMore}>
        <div className="form-grid">
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
      </Disclosure>

      <ErrorNote error={error} />

      {first && (
        <section className="sheet prospects-loading" aria-label="Loading activity">
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}

      {!loading && !error && rows.length === 0 && (
        <section className="sheet">
          {narrowed ? (
            <EmptyState kind="folder" title="No activity matches" action={<button type="button" className="secondary" onClick={reset}>Show everything</button>}>
              Try a different word or a wider choice.
            </EmptyState>
          ) : (
            <EmptyState kind="ledger" title="Nothing recorded yet">Activity on client files will appear here as people work.</EmptyState>
          )}
        </section>
      )}

      {rows.length > 0 && (
        <section className="sheet prospects-sheet">
          <div className="prospects-scroll">
            <table className="prospects-table" aria-label="Activity history">
              <thead><tr><th>When</th><th>What happened</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.seq}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td>
                    <td>{e.sentence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {next !== null && (
        <div>
          <button type="button" className="secondary" disabled={loading} onClick={() => load(next)}>Show older</button>
          {query.trim() !== '' && <span className="small muted"> Search looks only at what is shown so far.</span>}
        </div>
      )}
    </div>
  );
}
