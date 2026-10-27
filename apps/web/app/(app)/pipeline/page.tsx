'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';

interface Prospect {
  id: string; name: string; sector: string | null; contactName: string | null; source: string | null; ownerId: string; ownerName: string;
  stage: 'lead' | 'proposal' | 'loe_sent' | 'won' | 'lost'; expectedFee: string | null; expectedStart: string | null; notes: string | null;
  lostReason: string | null; clientId: string | null;
}
interface Summary { byStage: Record<string, { count: number; value: string }>; byOwner: { ownerId: string; ownerName: string; count: number; value: string }[] }
interface Person { id: string; fullName: string | null; email: string; role: string }

const OPEN = [
  { id: 'lead', label: 'Lead' },
  { id: 'proposal', label: 'Proposal sent' },
  { id: 'loe_sent', label: 'Engagement letter sent' },
] as const;
const kes = (v: string | null) => (v === null ? 'No fee yet' : `KES ${Number(v).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

function Card({ p, me, people, onChanged }: { p: Prospect; me: { userId: string; role: string }; people: Person[]; onChanged: () => void }) {
  const [mode, setMode] = useState<'none' | 'lost' | 'owner' | 'convert'>('none');
  const [reason, setReason] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [conv, setConv] = useState({ legalForm: 'Limited company', yearEndMonth: 12, accountManagerId: '' });
  const [error, setError] = useState<unknown>();
  const manager = me.role === 'manager' || me.role === 'partner';

  async function run(fn: () => Promise<unknown>) {
    setError(undefined);
    try {
      await fn();
      setMode('none');
      setReason('');
      onChanged();
    } catch (e) {
      setError(e);
    }
  }
  const move = (stage: string) => run(() => api.post(`/prospects/${p.id}/stage`, { stage }));

  return (
    <li className="card">
      <strong>{p.name}</strong>
      <div className="small muted">{[p.sector ? SECTOR_LABELS[p.sector] ?? p.sector : null, p.contactName].filter(Boolean).join(' · ') || 'No details yet'}</div>
      <div>{kes(p.expectedFee)}{p.expectedStart ? ` · starts ${fmtDate(p.expectedStart)}` : ''}</div>
      <div className="small">Owner: {p.ownerName}</div>
      {p.notes && <div className="small muted">{p.notes}</div>}

      <div className="row" style={{ marginTop: '0.4rem' }}>
        <label className="small" htmlFor={`st-${p.id}`}>Move to</label>
        <select id={`st-${p.id}`} value={p.stage} onChange={(e) => (e.target.value === 'lost' ? setMode('lost') : void move(e.target.value))} style={{ width: 'auto' }}>
          {OPEN.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          <option value="lost">Lost…</option>
        </select>
        {manager && <button className="quiet" onClick={() => setMode(mode === 'owner' ? 'none' : 'owner')}>Hand over</button>}
        {manager && <button className="secondary" onClick={() => setMode(mode === 'convert' ? 'none' : 'convert')}>Won: make a client</button>}
      </div>

      {mode === 'lost' && (
        <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.post(`/prospects/${p.id}/stage`, { stage: 'lost', reason })); }}>
          <input aria-label={`Why ${p.name} was lost`} placeholder="Why was it lost?" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="danger">Mark as lost</button>
          <button type="button" className="quiet" onClick={() => setMode('none')}>Cancel</button>
        </form>
      )}
      {mode === 'owner' && (
        <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.post(`/prospects/${p.id}/owner`, { userId: newOwner, reason })); }}>
          <select aria-label={`New owner of ${p.name}`} required value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
            <option value="">Choose a person</option>
            {people.filter((x) => x.id !== p.ownerId).map((x) => <option key={x.id} value={x.id}>{x.fullName ?? x.email}</option>)}
          </select>
          <input aria-label={`Reason for handing over ${p.name}`} placeholder="Why? (recorded)" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="secondary">Hand over</button>
        </form>
      )}
      {mode === 'convert' && (
        <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.post(`/prospects/${p.id}/convert`, { legalForm: conv.legalForm, yearEndMonth: Number(conv.yearEndMonth), ...(conv.accountManagerId ? { accountManagerId: conv.accountManagerId } : {}) })); }}>
          <div className="row">
            <input aria-label="Legal form" value={conv.legalForm} onChange={(e) => setConv({ ...conv, legalForm: e.target.value })} required />
            <select aria-label="Year end month" value={conv.yearEndMonth} onChange={(e) => setConv({ ...conv, yearEndMonth: Number(e.target.value) })}>
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => <option key={m} value={i + 1}>{m} year end</option>)}
            </select>
            <select aria-label="Account manager" value={conv.accountManagerId} onChange={(e) => setConv({ ...conv, accountManagerId: e.target.value })}>
              <option value="">Account manager: me</option>
              {people.filter((x) => (x.role === 'manager' || x.role === 'partner') && x.id !== me.userId).map((x) => <option key={x.id} value={x.id}>{x.fullName ?? x.email}</option>)}
            </select>
            <button>Create the client</button>
          </div>
          <span className="small muted">The prospect becomes a client. You then open an engagement for it from Engagements.</span>
        </form>
      )}
      <ErrorNote error={error} />
    </li>
  );
}

export default function PipelinePage() {
  const data = useApi<{ prospects: Prospect[]; summary: Summary }>('/prospects');
  const me = useApi<{ userId: string; role: string }>('/me');
  const people = useApi<{ people: Person[] }>('/people');
  const [form, setForm] = useState({ name: '', sector: 'trading', contactName: '', expectedFee: '', expectedStart: '', ownerId: '' });
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');
  const manager = me.data?.role === 'manager' || me.data?.role === 'partner';

  async function add(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setDone('');
    const body: Record<string, unknown> = { name: form.name, sector: form.sector };
    if (form.contactName.trim()) body.contactName = form.contactName;
    if (form.expectedFee.trim()) body.expectedFee = form.expectedFee;
    if (form.expectedStart) body.expectedStart = form.expectedStart;
    if (form.ownerId) body.ownerId = form.ownerId;
    try {
      await api.post('/prospects', body);
      setDone(`${form.name} added to the pipeline.`);
      setForm({ ...form, name: '', contactName: '', expectedFee: '', expectedStart: '' });
      data.reload();
    } catch (e) {
      setError(e);
    }
  }

  const prospects = data.data?.prospects ?? [];
  const summary = data.data?.summary;
  const closed = prospects.filter((p) => p.stage === 'won' || p.stage === 'lost');

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>Pipeline</h1><HelpLink topic="pipeline" /></div>
        <p>Prospective clients, from first contact to signed engagement letter. Each one has an owner. {manager ? 'You see the whole pipeline.' : 'You see the prospects you own.'}</p>
      </div>
      <ErrorNote error={data.error} />

      {summary && (
        <section className="sheet">
          <div className="row" style={{ gap: '2rem' }}>
            {OPEN.map((s) => (
              <div key={s.id}><div className="small muted">{s.label}</div><strong>{summary.byStage[s.id]?.count ?? 0}</strong> · {kes(summary.byStage[s.id]?.value ?? '0')}</div>
            ))}
            <div><div className="small muted">Won</div><strong>{summary.byStage.won?.count ?? 0}</strong></div>
            <div><div className="small muted">Lost</div><strong>{summary.byStage.lost?.count ?? 0}</strong></div>
          </div>
          {manager && summary.byOwner.length > 0 && (
            <p className="small" style={{ marginBottom: 0 }}>
              <strong>By person:</strong> {summary.byOwner.map((o) => `${o.ownerName}: ${o.count} (${kes(o.value)})`).join(' · ')}
            </p>
          )}
        </section>
      )}

      <form className="sheet stack" onSubmit={add}>
        <h2>Add a prospect</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="pn">Name</label><input id="pn" required minLength={2} maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="ps">Sector</label>
            <select id="ps" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>{Object.entries(SECTOR_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="pc">Contact</label><input id="pc" maxLength={120} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
          <div className="field"><label htmlFor="pf">Expected fee (KES)</label><input id="pf" inputMode="decimal" placeholder="450000" value={form.expectedFee} onChange={(e) => setForm({ ...form, expectedFee: e.target.value })} /></div>
          <div className="field"><label htmlFor="pd">Expected start</label><input id="pd" type="date" value={form.expectedStart} onChange={(e) => setForm({ ...form, expectedStart: e.target.value })} /></div>
          {manager && (
            <div className="field">
              <label htmlFor="po">Owner</label>
              <select id="po" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
                <option value="">Me</option>
                {people.data?.people.filter((p) => p.id !== me.data?.userId).map((p) => <option key={p.id} value={p.id}>{p.fullName ?? p.email}</option>)}
              </select>
            </div>
          )}
        </div>
        <ErrorNote error={error} />
        {done && <Notice>{done}</Notice>}
        <div><button>Add to pipeline</button></div>
      </form>

      {data.data && prospects.length === 0 && <Empty>Nothing in the pipeline yet. Add the first prospect above.</Empty>}
      <div className="board">
        {OPEN.map((s) => (
          <section key={s.id} className="sheet" aria-label={s.label}>
            <h2>{s.label}</h2>
            <ul className="cards">
              {prospects.filter((p) => p.stage === s.id).map((p) => (
                <Card key={p.id} p={p} me={me.data ?? { userId: '', role: '' }} people={people.data?.people ?? []} onChanged={data.reload} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {closed.length > 0 && (
        <section className="sheet">
          <h2>Closed</h2>
          <table>
            <thead><tr><th>Prospect</th><th>Outcome</th><th>Owner</th></tr></thead>
            <tbody>
              {closed.map((p) => (
                <tr key={p.id}><td>{p.name}</td><td>{p.stage === 'won' ? 'Won: now a client' : `Lost: ${p.lostReason ?? ''}`}</td><td>{p.ownerName}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
