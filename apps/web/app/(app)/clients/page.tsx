'use client';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { SidePanel } from '@/components/ui/SidePanel';
import { SECTOR_LABELS } from '@/lib/text';

interface Client { id: string; name: string; sector: string; legalForm: string; framework: string; yearEndMonth: number; accountManagerName: string | null; relationship: 'account_manager' | 'team' | 'oversight' }
const WHY = { account_manager: 'You manage it', team: 'You are on the team', oversight: 'Partner or administrator view' } as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FORM = 'add-client-form';
const BLANK = { name: '', sector: 'trading', legalForm: 'Limited company', framework: 'IFRS_SME', yearEndMonth: 12, accountManagerId: '' };

export default function ClientsPage() {
  const list = useApi<{ clients: Client[] }>('/clients');
  const me = useApi<{ userId: string; role: string }>('/me');
  const people = useApi<{ people: { id: string; fullName: string | null; email: string; role: string }[] }>('/people');
  const canAdd = me.data?.role === 'manager' || me.data?.role === 'partner';
  const managers = people.data?.people.filter((p) => p.role === 'manager' || p.role === 'partner') ?? [];
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const all = useMemo(() => list.data?.clients ?? [], [list.data]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((c) => [c.name, c.accountManagerName ?? '', SECTOR_LABELS[c.sector] ?? c.sector].some((t) => t.toLowerCase().includes(q))) : all;
  }, [all, query]);

  function close() {
    setPanel(false);
    setError(undefined);
    setBusy(false);
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await api.post('/clients', { ...form, yearEndMonth: Number(form.yearEndMonth), accountManagerId: form.accountManagerId || undefined });
      setNotice(`${form.name} added.`);
      setForm(BLANK);
      setPanel(false);
      setBusy(false);
      list.reload();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const addButton = canAdd ? <button type="button" onClick={() => { setNotice(''); setPanel(true); }}>+ Add a client</button> : undefined;
  const loading = list.loading && !list.data;

  return (
    <div className="stack-lg">
      <PageHead
        title="Clients"
        sentence="The clients you are assigned to. Each client has one account manager, who is accountable for the relationship. Partners and administrators see every client."
        action={addButton}
        help={<HelpLink topic="clients" />}
      />
      <ErrorNote error={list.error} />
      {notice && <Notice>{notice}</Notice>}

      {loading && (
        <section className="sheet prospects-loading" aria-label="Loading clients">
          <Skeleton height={36} width="40%" />
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}

      {list.data && all.length === 0 && !me.loading && (
        <section className="sheet">
          <EmptyState kind="people" title="No clients yet">
            {canAdd ? 'Use Add a client at the top to start an engagement.' : 'No clients assigned to you yet.'}
          </EmptyState>
        </section>
      )}

      {list.data && all.length > 0 && (
        <>
          <div className="prospects-toolbar">
            <input type="search" className="prospects-search" aria-label="Search clients" placeholder="Search by client, manager or sector" value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="small muted" role="status" aria-live="polite">{rows.length === all.length ? `${all.length} ${all.length === 1 ? 'client' : 'clients'}` : `${rows.length} of ${all.length}`}</span>
          </div>
          {rows.length === 0 ? (
            <section className="sheet">
              <EmptyState kind="folder" title="No clients match" action={<button type="button" className="secondary" onClick={() => setQuery('')}>Show everything</button>}>
                Try a different word.
              </EmptyState>
            </section>
          ) : (
            <section className="sheet prospects-sheet">
              <div className="prospects-scroll">
                <table className="prospects-table">
                  <thead><tr><th>Client</th><th>Account manager</th><th>Sector</th><th>Year end</th><th>Why you see it</th></tr></thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/clients/${c.id}`}><strong>{c.name}</strong></Link>
                          <div className="small muted">{c.legalForm} · {c.framework === 'IFRS_SME' ? 'IFRS for SMEs' : 'Full IFRS'}</div>
                        </td>
                        <td>{c.accountManagerName ?? 'Not set'}</td>
                        <td>{SECTOR_LABELS[c.sector] ?? c.sector}</td>
                        <td>{MONTHS[c.yearEndMonth - 1]}</td>
                        <td className="muted">{WHY[c.relationship]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {canAdd && (
        <SidePanel
          open={panel}
          title="Add a client"
          onClose={close}
          footer={
            <>
              <button type="button" className="quiet" onClick={close}>Cancel</button>
              <button type="submit" form={FORM} disabled={busy}>Add client</button>
            </>
          }
        >
          <form id={FORM} className="stack" onSubmit={submit}>
            <div className="field"><label htmlFor="cn">Name</label><input id="cn" required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="cs">Sector</label>
              <select id="cs" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>
                {Object.entries(SECTOR_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="cl">Legal form</label><input id="cl" required value={form.legalForm} onChange={(e) => setForm({ ...form, legalForm: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="cf">Reporting framework</label>
              <select id="cf" value={form.framework} onChange={(e) => setForm({ ...form, framework: e.target.value })}>
                <option value="IFRS_SME">IFRS for SMEs</option>
                <option value="FULL_IFRS">Full IFRS (statements not available yet)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cm">Account manager</label>
              <select id="cm" value={form.accountManagerId} onChange={(e) => setForm({ ...form, accountManagerId: e.target.value })}>
                <option value="">Me</option>
                {managers.filter((m) => m.id !== me.data?.userId).map((m) => <option key={m.id} value={m.id}>{m.fullName ?? m.email}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cy">Year end month</label>
              <select id="cy" value={form.yearEndMonth} onChange={(e) => setForm({ ...form, yearEndMonth: Number(e.target.value) })}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <ErrorNote error={error} />
          </form>
        </SidePanel>
      )}
    </div>
  );
}
