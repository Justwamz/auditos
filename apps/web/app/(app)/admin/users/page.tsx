'use client';
import { Fragment, useState, type FormEvent } from 'react';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { ROLE_LABELS } from '@/lib/text';

interface Holding { clients: { id: string; name: string }[]; prospects: { id: string; name: string }[] }

/** What someone still holds, and a way to hand all of it to a colleague before they leave. */
function HandoverPanel({ user, people, onDone }: { user: User; people: User[]; onDone: () => void }) {
  const held = useApi<Holding>(`/admin/users/${user.id}/handover`);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');
  const h = held.data;
  const nothing = h && h.clients.length === 0 && h.prospects.length === 0;
  const needsManager = (h?.clients.length ?? 0) > 0;
  const targets = people.filter((p) => p.id !== user.id && p.active && (needsManager ? p.role === 'manager' || p.role === 'partner' : !['firm_admin', 'quality_officer', 'eqr'].includes(p.role)));

  async function go(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    try {
      const r = await api.post<{ clients: number; prospects: number }>(`/admin/users/${user.id}/handover`, { toUserId: to, reason });
      setDone(`Handed over ${r.clients} client(s) and ${r.prospects} prospect(s).`);
      held.reload();
      onDone();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="stack small" style={{ padding: '0.6rem 0' }}>
      <ErrorNote error={held.error} />
      {h && (
        <>
          <div><strong>Clients managed:</strong> {h.clients.length > 0 ? h.clients.map((c) => c.name).join(', ') : 'none'}</div>
          <div><strong>Open prospects:</strong> {h.prospects.length > 0 ? h.prospects.map((c) => c.name).join(', ') : 'none'}</div>
        </>
      )}
      {nothing && <Notice>Nothing to hand over. This person can be switched off.</Notice>}
      {h && !nothing && (
        <form className="row" onSubmit={go}>
          <select aria-label={`Hand over ${user.fullName ?? user.email} to`} required value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Hand everything to…</option>
            {targets.map((p) => <option key={p.id} value={p.id}>{p.fullName ?? p.email}</option>)}
          </select>
          <input aria-label="Reason for the handover" placeholder="Why? (recorded)" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="secondary">Hand over</button>
        </form>
      )}
      {done && <Notice>{done}</Notice>}
      <ErrorNote error={error} />
    </div>
  );
}

interface User { id: string; fullName: string | null; email: string; role: string; isAdmin: boolean; active: boolean; mfaEnabled: boolean }

export default function PeoplePage() {
  const list = useApi<{ users: User[] }>('/admin/users');
  const [form, setForm] = useState({ fullName: '', email: '', role: 'staff', isAdmin: false });
  const [error, setError] = useState<unknown>();
  const [link, setLink] = useState('');
  const [handover, setHandover] = useState<string | null>(null);

  async function invite(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setLink('');
    try {
      const r = await api.post<{ inviteToken: string | null }>('/admin/users', { ...form, fullName: form.fullName.trim(), email: form.email.trim() });
      if (r.inviteToken) setLink(`${window.location.origin}/accept-invite?token=${encodeURIComponent(r.inviteToken)}`);
      setForm({ fullName: '', email: '', role: 'staff', isAdmin: false });
      list.reload();
    } catch (e) {
      setError(e);
    }
  }

  async function patch(id: string, body: object) {
    setError(undefined);
    try {
      await api.patch(`/admin/users/${id}`, body);
      list.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>People and access</h1><HelpLink topic="admin.users" /></div>
        <p>Every account belongs to one named person. There are no shared logins. Administration is a permission you give to a named person, whatever their role.</p>
      </div>
      <form className="sheet stack" onSubmit={invite}>
        <h2>Invite someone</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="in">Full name</label><input id="in" required minLength={4} maxLength={120} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
          <div className="field"><label htmlFor="ie">Personal email</label><input id="ie" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="ir">Role</label>
            <select id="ir" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <label className="row small"><input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} /> Can manage people and access, and read the audit trail</label>
        <p className="muted small">Addresses like admin@, info@ or accounts@ are refused, because nobody can be held to account for a shared login.</p>
        <div><button>Create invite</button></div>
        {link && (
          <Notice>
            Send this one-time link to {form.fullName || 'the new user'}. It expires in 72 hours and works once.
            <div className="secret small" style={{ marginTop: '0.4rem' }}>{link}</div>
          </Notice>
        )}
      </form>

      <ErrorNote error={error ?? list.error} />
      <section className="sheet">
        <h2>Everyone in the firm</h2>
        <table>
          <thead><tr><th>Person</th><th>Role</th><th>Can administer</th><th>Authenticator</th><th>Access</th></tr></thead>
          <tbody>
            {list.data?.users.map((u) => (
              <Fragment key={u.id}>
              <tr>
                <td><strong>{u.fullName ?? u.email}</strong>{u.fullName && <div className="small muted">{u.email}</div>}</td>
                <td>
                  <select aria-label={`Role for ${u.fullName ?? u.email}`} value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td>
                  {u.role === 'firm_admin' ? 'Yes (role)' : (
                    <label className="row small"><input type="checkbox" checked={u.isAdmin} aria-label={`Admin permission for ${u.fullName ?? u.email}`} onChange={(e) => patch(u.id, { isAdmin: e.target.checked })} /> {u.isAdmin ? 'Yes' : 'No'}</label>
                  )}
                </td>
                <td>{u.mfaEnabled ? 'Set up' : 'Not yet'}</td>
                <td>
                  <div className="row">
                    {u.active ? <button className="danger" onClick={() => patch(u.id, { active: false })}>Switch off</button> : <button className="secondary" onClick={() => patch(u.id, { active: true })}>Switch on</button>}
                    {u.active && u.role !== 'firm_admin' && <button className="quiet" onClick={() => setHandover(handover === u.id ? null : u.id)}>{handover === u.id ? 'Close' : 'Hand over'}</button>}
                  </div>
                </td>
              </tr>
              {handover === u.id && <tr><td colSpan={5}><HandoverPanel user={u} people={list.data?.users ?? []} onDone={() => list.reload()} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
