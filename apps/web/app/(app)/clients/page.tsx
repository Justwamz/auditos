'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, Notice } from '@/components/bits';
import { SECTOR_LABELS } from '@/lib/text';

interface Client { id: string; name: string; sector: string; legalForm: string; framework: string; yearEndMonth: number; accountManagerName: string | null; relationship: 'account_manager' | 'team' | 'oversight' }
const WHY = { account_manager: 'You manage it', team: 'You are on the team', oversight: 'Partner or administrator view' } as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function ClientsPage() {
  const list = useApi<{ clients: Client[] }>('/clients');
  const me = useApi<{ userId: string; role: string }>('/me');
  const people = useApi<{ people: { id: string; fullName: string | null; email: string; role: string }[] }>('/people');
  const canAdd = me.data?.role === 'manager' || me.data?.role === 'partner';
  const managers = people.data?.people.filter((p) => p.role === 'manager' || p.role === 'partner') ?? [];
  const [form, setForm] = useState({ name: '', sector: 'trading', legalForm: 'Limited company', framework: 'IFRS_SME', yearEndMonth: 12, accountManagerId: '' });
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setDone('');
    try {
      await api.post('/clients', { ...form, yearEndMonth: Number(form.yearEndMonth), accountManagerId: form.accountManagerId || undefined });
      setDone(`${form.name} added.`);
      setForm({ ...form, name: '' });
      list.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>Clients</h1><HelpLink topic="clients" /></div>
        <p>The clients you are assigned to. Each client has one account manager, who is accountable for the relationship. Partners and administrators see every client.</p>
      </div>

      {canAdd && (
      <section className="sheet">
        <h2>Add a client</h2>
        <form onSubmit={submit} className="stack">
          <div className="form-grid">
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
          </div>
          <ErrorNote error={error} />
          {done && <Notice>{done}</Notice>}
          <div><button>Add client</button></div>
        </form>
      </section>
      )}

      <section className="sheet">
        <h2>All clients</h2>
        <ErrorNote error={list.error} />
        {list.data && list.data.clients.length === 0 && <Empty>No clients assigned to you yet.</Empty>}
        {list.data && list.data.clients.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Why you see it</th><th>Account manager</th><th>Sector</th><th>Legal form</th><th>Framework</th><th>Year end</th></tr></thead>
            <tbody>
              {list.data.clients.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clients/${c.id}`}>{c.name}</Link></td><td>{WHY[c.relationship]}</td><td>{c.accountManagerName ?? 'Not set'}</td><td>{SECTOR_LABELS[c.sector] ?? c.sector}</td><td>{c.legalForm}</td>
                  <td>{c.framework === 'IFRS_SME' ? 'IFRS for SMEs' : 'Full IFRS'}</td><td>{MONTHS[c.yearEndMonth - 1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
