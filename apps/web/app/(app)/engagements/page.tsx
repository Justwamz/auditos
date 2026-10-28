'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, StateBadge } from '@/components/bits';
import { Chips } from '@/components/ui/Chips';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { SidePanel } from '@/components/ui/SidePanel';
import { countByGroup, filterEngagements, STAGE_GROUPS, type StageGroup } from '@/lib/engagements';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';

interface Eng { id: string; clientName: string; sector: string; periodStart: string; periodEnd: string; state: string; member: boolean }
interface Me { role: string }

const FORM = 'open-engagement-form';
const BLANK = { clientId: '', periodStart: '', periodEnd: '', partnerId: '', fraud: false, firstYear: false, eqr: false };

export default function EngagementsPage() {
  const router = useRouter();
  const list = useApi<{ engagements: Eng[] }>('/engagements');
  const me = useApi<Me>('/me');
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/clients');
  const people = useApi<{ people: { id: string; email: string; role: string }[] }>('/people');
  const canCreate = me.data?.role === 'manager' || me.data?.role === 'partner';
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<unknown>();
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<StageGroup>('all');

  const all = useMemo(() => list.data?.engagements ?? [], [list.data]);
  const counts = useMemo(() => countByGroup(all), [all]);
  const rows = useMemo(() => filterEngagements(all, { group, query }), [all, group, query]);

  function close() {
    setPanel(false);
    setError(undefined);
    setBusy(false);
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setBusy(true);
    const riskFlags = [form.fraud && 'fraud', form.firstYear && 'first_year', form.eqr && 'eqr_required'].filter(Boolean);
    try {
      const r = await api.post<{ id: string }>('/engagements', { clientId: form.clientId, periodStart: form.periodStart, periodEnd: form.periodEnd, partnerId: form.partnerId, riskFlags });
      router.push(`/engagements/${r.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const partners = people.data?.people.filter((p) => p.role === 'partner') ?? [];
  const openButton = canCreate ? <button type="button" onClick={() => setPanel(true)}>+ Open an engagement</button> : undefined;
  const loading = list.loading && !list.data;
  const options = [{ id: 'all', label: 'All', count: counts.all }, ...STAGE_GROUPS.map((g) => ({ id: g.id, label: g.label, count: counts[g.id] }))];

  return (
    <div className="stack-lg">
      <PageHead
        title="Engagements"
        sentence="The engagements you can open: the ones you are on the team of. Partners also see, and can read, every other engagement of the firm."
        action={openButton}
        help={<HelpLink topic="engagements.new" />}
      />
      <ErrorNote error={list.error} />

      {loading && (
        <section className="sheet prospects-loading" aria-label="Loading engagements">
          <Skeleton height={36} width="40%" />
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}

      {list.data && all.length === 0 && !me.loading && (
        <section className="sheet">
          <EmptyState kind="folder" title="No engagements yet.">
            {canCreate ? 'Use Open an engagement at the top to start the first one.' : 'You are not on an engagement team yet.'}
          </EmptyState>
        </section>
      )}

      {list.data && all.length > 0 && (
        <>
          <Chips label="Stage" value={group} onChange={(id) => setGroup(id as StageGroup)} options={options} />
          <div className="prospects-toolbar">
            <input type="search" className="prospects-search" aria-label="Search engagements" placeholder="Search by client or sector" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="small muted" role="status" aria-live="polite">{rows.length === all.length ? `${all.length} ${all.length === 1 ? 'engagement' : 'engagements'}` : `${rows.length} of ${all.length}`}</span>
          </div>
          {rows.length === 0 ? (
            <section className="sheet">
              <EmptyState kind="folder" title="No engagements match" action={<button type="button" className="secondary" onClick={() => { setQuery(''); setGroup('all'); }}>Show everything</button>}>
                Try a different word or stage.
              </EmptyState>
            </section>
          ) : (
            <section className="sheet prospects-sheet">
              <div className="prospects-scroll">
                <table className="prospects-table">
                  <thead><tr><th>Client</th><th>Sector</th><th>Period</th><th>Stage</th></tr></thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id}>
                        <td><Link href={`/engagements/${e.id}`}><strong>{e.clientName}</strong></Link>{!e.member && <div className="small muted">View only</div>}</td>
                        <td>{SECTOR_LABELS[e.sector] ?? e.sector}</td>
                        <td>{fmtDate(e.periodStart)} to {fmtDate(e.periodEnd)}</td>
                        <td><StateBadge state={e.state} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {canCreate && (
        <SidePanel
          open={panel}
          title="Open an engagement"
          onClose={close}
          footer={
            <>
              <button type="button" className="quiet" onClick={close}>Cancel</button>
              <button type="submit" form={FORM} disabled={busy}>{busy ? 'Opening…' : 'Open engagement'}</button>
            </>
          }
        >
          <form id={FORM} className="stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="ec">Client</label>
              <select id="ec" required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">Choose a client</option>
                {clients.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="es">Period start</label><input id="es" type="date" required value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></div>
            <div className="field"><label htmlFor="ee">Period end</label><input id="ee" type="date" required value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="ep">Engagement partner <span className="hint">needs a current independence declaration</span></label>
              <select id="ep" required value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })}>
                <option value="">Choose a partner</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.email}</option>)}
              </select>
            </div>
            <fieldset className="plain-fieldset">
              <legend>Risk flags</legend>
              <p className="small muted">They add checklist items and hold the engagement back until they are done.</p>
              <div className="stack">
                <label className="row check-row"><input type="checkbox" checked={form.fraud} onChange={(e) => setForm({ ...form, fraud: e.target.checked })} /> Elevated fraud risk</label>
                <label className="row check-row"><input type="checkbox" checked={form.firstYear} onChange={(e) => setForm({ ...form, firstYear: e.target.checked })} /> First-year engagement</label>
                <label className="row check-row"><input type="checkbox" checked={form.eqr} onChange={(e) => setForm({ ...form, eqr: e.target.checked })} /> Needs an engagement quality review</label>
              </div>
            </fieldset>
            <ErrorNote error={error} />
          </form>
        </SidePanel>
      )}
    </div>
  );
}
