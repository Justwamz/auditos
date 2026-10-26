'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { ROLE_LABELS } from '@/lib/text';

interface User { id: string; email: string; role: string; active: boolean; mfaEnabled: boolean }

export default function PeoplePage() {
  const list = useApi<{ users: User[] }>('/admin/users');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  const [error, setError] = useState<unknown>();
  const [link, setLink] = useState('');

  async function invite(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setLink('');
    try {
      const r = await api.post<{ inviteToken: string }>('/admin/users', { email: email.trim(), role });
      setLink(`${window.location.origin}/accept-invite?token=${encodeURIComponent(r.inviteToken)}`);
      setEmail('');
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
        <h1>People and access</h1>
        <p>Add staff, change roles and switch access off. Firm administrators cannot see engagement content.</p>
      </div>
      <form className="sheet stack" onSubmit={invite}>
        <h2>Invite someone</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="ie">Email</label><input id="ie" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field">
            <label htmlFor="ir">Role</label>
            <select id="ir" value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div><button>Create invite</button></div>
        {link && (
          <Notice>
            Send this one-time link to {`the new user`}. It expires in 72 hours and works once.
            <div className="secret small" style={{ marginTop: '0.4rem' }}>{link}</div>
          </Notice>
        )}
      </form>

      <ErrorNote error={error ?? list.error} />
      <section className="sheet">
        <h2>Everyone in the firm</h2>
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Authenticator</th><th>Access</th></tr></thead>
          <tbody>
            {list.data?.users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td>{u.mfaEnabled ? 'Set up' : 'Not yet'}</td>
                <td>{u.active ? <button className="danger" onClick={() => patch(u.id, { active: false })}>Switch off</button> : <button className="secondary" onClick={() => patch(u.id, { active: true })}>Switch on</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
