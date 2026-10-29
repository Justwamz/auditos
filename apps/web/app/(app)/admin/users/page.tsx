'use client';
import { useState, type FormEvent } from 'react';
import { HelpLink } from '@/components/HelpLink';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { RowMenu } from '@/components/ui/RowMenu';
import { SidePanel } from '@/components/ui/SidePanel';
import { ROLE_LABELS } from '@/lib/text';

interface Holding { clients: { id: string; name: string }[]; prospects: { id: string; name: string }[] }
interface User { id: string; fullName: string | null; email: string; role: string; isAdmin: boolean; active: boolean; mfaEnabled: boolean }

const INVITE = 'invite-form';
const HANDOVER = 'handover-form';
const BLANK = { fullName: '', email: '', role: 'staff', isAdmin: false };
const nameOf = (u: User) => u.fullName ?? u.email;

/** What someone still holds, and a way to hand all of it to a colleague before they leave. */
function HandoverPanel({ user, people, onDone, onClose }: { user: User; people: User[]; onDone: () => void; onClose: () => void }) {
  const held = useApi<Holding>(`/admin/users/${user.id}/handover`);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const h = held.data;
  const nothing = h && h.clients.length === 0 && h.prospects.length === 0;
  const needsManager = (h?.clients.length ?? 0) > 0;
  const targets = people.filter((p) => p.id !== user.id && p.active && (needsManager ? p.role === 'manager' || p.role === 'partner' : !['firm_admin', 'quality_officer', 'eqr'].includes(p.role)));

  async function go(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const r = await api.post<{ clients: number; prospects: number }>(`/admin/users/${user.id}/handover`, { toUserId: to, reason });
      setDone(`Handed over ${r.clients} client(s) and ${r.prospects} prospect(s).`);
      held.reload();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel
      open
      title={`Hand over ${nameOf(user)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>Close</button>
          {h && !nothing && <button type="submit" form={HANDOVER} disabled={busy}>Hand over</button>}
        </>
      }
    >
      <div className="stack">
        <ErrorNote error={held.error} />
        {h && (
          <>
            <div><strong>Clients managed:</strong> {h.clients.length > 0 ? h.clients.map((c) => c.name).join(', ') : 'none'}</div>
            <div><strong>Open prospects:</strong> {h.prospects.length > 0 ? h.prospects.map((c) => c.name).join(', ') : 'none'}</div>
          </>
        )}
        {nothing && <Notice>Nothing to hand over. This person can have their access paused.</Notice>}
        {h && !nothing && (
          <form id={HANDOVER} className="stack" onSubmit={go}>
            <div className="field">
              <label htmlFor="ho-to">Hand everything to</label>
              <select id="ho-to" required value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a person</option>
                {targets.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ho-why">Why? <span className="hint">recorded</span></label>
              <input id="ho-why" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </form>
        )}
        {done && <Notice>{done}</Notice>}
        <ErrorNote error={error} />
      </div>
    </SidePanel>
  );
}

export default function PeoplePage() {
  const list = useApi<{ users: User[] }>('/admin/users');
  const [form, setForm] = useState(BLANK);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteError, setInviteError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [link, setLink] = useState('');
  const [invited, setInvited] = useState('');
  const [handover, setHandover] = useState<User | null>(null);

  function close() {
    setPanel(false);
    setInviteError(undefined);
    setBusy(false);
  }

  async function invite(ev: FormEvent) {
    ev.preventDefault();
    setInviteError(undefined);
    setBusy(true);
    try {
      const r = await api.post<{ inviteToken: string | null }>('/admin/users', { ...form, fullName: form.fullName.trim(), email: form.email.trim() });
      setLink(r.inviteToken ? `${window.location.origin}/accept-invite?invite=${encodeURIComponent(r.inviteToken)}` : '');
      setInvited(form.fullName.trim());
      setForm(BLANK);
      setPanel(false);
      setBusy(false);
      list.reload();
    } catch (e) {
      setInviteError(e);
      setBusy(false);
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

  const users = list.data?.users ?? [];
  const loading = list.loading && !list.data;

  return (
    <div className="stack-lg">
      <PageHead
        title="People"
        sentence="Every account belongs to one named person, so there are no shared logins."
        action={<button type="button" onClick={() => { setLink(''); setInvited(''); setPanel(true); }}>+ Invite someone</button>}
        help={<HelpLink topic="admin.users" />}
      />
      <ErrorNote error={error ?? list.error} />
      {invited && (
        <Notice>
          {link ? <>Send this one-time link to {invited}. It expires in 72 hours and works once.</> : <>Invited {invited}.</>}
          {link && <div className="secret small" style={{ marginTop: '0.4rem' }}>{link}</div>}
        </Notice>
      )}

      {loading && (
        <section className="sheet prospects-loading" aria-label="Loading people">
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}

      {list.data && users.length === 0 && (
        <section className="sheet">
          <EmptyState kind="people" title="No one here yet">Use Invite someone at the top to add the first person.</EmptyState>
        </section>
      )}

      {users.length > 0 && (
        <section className="sheet prospects-sheet">
          <div className="prospects-scroll">
            <table className="prospects-table" aria-label="Everyone in the firm">
              <thead><tr><th>Person</th><th>Role</th><th>Can administer</th><th>Sign-in code</th><th>Access</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{nameOf(u)}</strong>{u.fullName && <div className="small muted">{u.email}</div>}</td>
                    <td>
                      <select style={{ minWidth: '13rem' }} aria-label={`Role for ${nameOf(u)}`} value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>
                        {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td>
                      {u.role === 'firm_admin' ? 'Yes (role)' : (
                        <label className="row small"><input type="checkbox" checked={u.isAdmin} aria-label={`Admin permission for ${nameOf(u)}`} onChange={(e) => patch(u.id, { isAdmin: e.target.checked })} /> {u.isAdmin ? 'Yes' : 'No'}</label>
                      )}
                    </td>
                    <td>{u.mfaEnabled ? 'Set up' : 'Not yet'}</td>
                    <td><span className={u.active ? 'state manager_reviewed' : 'state draft'}>{u.active ? 'Active' : 'Paused'}</span></td>
                    <td>
                      <RowMenu
                        label={`Actions for ${nameOf(u)}`}
                        items={[
                          { label: 'Pause access', danger: true, hidden: !u.active, onSelect: () => patch(u.id, { active: false }) },
                          { label: 'Restore access', hidden: u.active, onSelect: () => patch(u.id, { active: true }) },
                          { label: 'Hand over', hidden: !u.active || u.role === 'firm_admin', onSelect: () => setHandover(u) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <SidePanel
        open={panel}
        title="Invite someone"
        onClose={close}
        footer={
          <>
            <button type="button" className="quiet" onClick={close}>Cancel</button>
            <button type="submit" form={INVITE} disabled={busy}>Create invite</button>
          </>
        }
      >
        <form id={INVITE} className="stack" onSubmit={invite}>
          <div className="field"><label htmlFor="in">Full name</label><input id="in" required minLength={4} maxLength={120} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
          <div className="field"><label htmlFor="ie">Personal email</label><input id="ie" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="ir">Role</label>
            <select id="ir" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <label className="row small"><input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} /> Can manage people and access, and read the activity history</label>
          <p className="muted small">Addresses like admin@, info@ or accounts@ are refused, because nobody can be held to account for a shared login.</p>
          <ErrorNote error={inviteError} />
        </form>
      </SidePanel>

      {handover && <HandoverPanel key={handover.id} user={handover} people={users} onDone={() => list.reload()} onClose={() => setHandover(null)} />}
    </div>
  );
}
