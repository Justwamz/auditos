'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, StateBadge } from '@/components/bits';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';

interface Eng { id: string; clientName: string; sector: string; periodStart: string; periodEnd: string; state: string }
interface Me { role: string }

export default function EngagementsPage() {
  const router = useRouter();
  const list = useApi<{ engagements: Eng[] }>('/engagements');
  const me = useApi<Me>('/me');
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/clients');
  const people = useApi<{ people: { id: string; email: string; role: string }[] }>('/people');
  const canCreate = me.data?.role === 'manager' || me.data?.role === 'partner';
  const [form, setForm] = useState({ clientId: '', periodStart: '', periodEnd: '', partnerId: '', fraud: false, firstYear: false, eqr: false });
  const [error, setError] = useState<unknown>();

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    const riskFlags = [form.fraud && 'fraud', form.firstYear && 'first_year', form.eqr && 'eqr_required'].filter(Boolean);
    try {
      const r = await api.post<{ id: string }>('/engagements', { clientId: form.clientId, periodStart: form.periodStart, periodEnd: form.periodEnd, partnerId: form.partnerId, riskFlags });
      router.push(`/engagements/${r.id}`);
    } catch (e) {
      setError(e);
    }
  }

  const partners = people.data?.people.filter((p) => p.role === 'partner') ?? [];

  return (
    <div className="stack-lg">
      <div className="page-head"><h1>Engagements</h1><p>You only see engagements you are assigned to.</p></div>

      {canCreate && (
        <section className="sheet">
          <h2>Open an engagement</h2>
          <form className="stack" onSubmit={submit}>
            <div className="form-grid">
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
            </div>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, fontSize: '0.9rem' }}>Risk flags <span className="hint">they add checklist items and gates</span></legend>
              <div className="row">
                <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" checked={form.fraud} onChange={(e) => setForm({ ...form, fraud: e.target.checked })} /> Elevated fraud risk</label>
                <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" checked={form.firstYear} onChange={(e) => setForm({ ...form, firstYear: e.target.checked })} /> First-year engagement</label>
                <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" checked={form.eqr} onChange={(e) => setForm({ ...form, eqr: e.target.checked })} /> Needs an engagement quality review</label>
              </div>
            </fieldset>
            <ErrorNote error={error} />
            <div><button>Open engagement</button></div>
          </form>
        </section>
      )}

      <section className="sheet">
        <ErrorNote error={list.error} />
        {list.data && list.data.engagements.length === 0 && <Empty>No engagements yet.</Empty>}
        {list.data && list.data.engagements.length > 0 && (
          <table>
            <thead><tr><th>Client</th><th>Sector</th><th>Period</th><th>Stage</th></tr></thead>
            <tbody>
              {list.data.engagements.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/engagements/${e.id}`}>{e.clientName}</Link></td>
                  <td>{SECTOR_LABELS[e.sector] ?? e.sector}</td>
                  <td>{fmtDate(e.periodStart)} to {fmtDate(e.periodEnd)}</td>
                  <td><StateBadge state={e.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
