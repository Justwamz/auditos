'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, Notice } from '@/components/bits';
import { useStepUp } from '@/components/StepUp';
import { Roadmap } from '@/components/Roadmap';
import { FeeCard } from '@/components/FeeCard';
import { fmtDate, GATE_LABELS, ROLE_LABELS, STAGES, STATE_LABELS } from '@/lib/text';
import type { Engagement, Me } from '../page';

interface Member { userId: string; fullName: string | null; email: string; role: string }
interface UnlockRequest { id: string; requestedBy: string; requestedByEmail: string; reason: string; status: string; createdAt: string }

export function Overview({ engagement: e, me, onChanged, onGo }: { engagement: Engagement; me: Me; onChanged: () => void; onGo: (tab: string) => void }) {
  const team = useApi<{ members: Member[] }>(`/engagements/${e.id}/members`);
  const people = useApi<{ people: { id: string; fullName: string | null; email: string; role: string }[] }>('/people');
  const unlocks = useApi<{ requests: UnlockRequest[] }>(e.state === 'locked' ? `/engagements/${e.id}/unlock-requests` : null);
  const withStepUp = useStepUp();
  const [error, setError] = useState<unknown>();
  const [blockers, setBlockers] = useState<{ gate: string; message: string }[]>([]);
  const [info, setInfo] = useState('');
  const [addId, setAddId] = useState('');
  const [eqrId, setEqrId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [unlockReason, setUnlockReason] = useState('');

  const idx = STAGES.indexOf(e.state as (typeof STAGES)[number]);
  const next = STAGES[idx + 1];
  const canMove = me.role === 'manager' || me.role === 'partner';
  const partnerOnly = next === 'partner_approved' || next === 'report_issued' || next === 'locked';
  const memberIds = new Set(team.data?.members.map((m) => m.userId));
  const candidates = people.data?.people.filter((p) => !memberIds.has(p.id)) ?? [];

  async function run(fn: () => Promise<unknown>, message = '') {
    setError(undefined);
    setInfo('');
    try {
      await fn();
      if (message) setInfo(message);
      team.reload();
      unlocks.reload();
      onChanged();
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') return;
      setError(err);
    }
  }

  async function move() {
    setBlockers([]);
    setError(undefined);
    setInfo('');
    try {
      // The last steps (approve, issue, lock) ask for a fresh authenticator code first.
      await withStepUp(() => api.post(`/engagements/${e.id}/transition`, { to: next, ...(next === 'report_issued' ? { reportDate } : {}) }));
      setInfo(`Moved to ${STATE_LABELS[next!]}.`);
      onChanged();
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') return;
      if (err instanceof ApiError && err.code === 'gate_blocked') setBlockers((err.body.blockers as { gate: string; message: string }[]) ?? []);
      else setError(err);
    }
  }

  return (
    <div className="stack-lg">
      <Roadmap engagementId={e.id} locked={e.state === 'locked' || !e.member} onGo={onGo} refreshKey={e.state} />
      {(me.role === 'manager' || me.role === 'partner') && <FeeCard engagementId={e.id} canEdit={e.member} />}
      <section className="sheet">
        <h2>Engagement stage</h2>
        <ol className="stages" aria-label="Engagement stages">
          {STAGES.map((s, i) => (
            <li key={s} className={i < idx ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>{STATE_LABELS[s]}</li>
          ))}
        </ol>
        {e.riskFlags.length > 0 && <p className="muted small">Risk flags: {e.riskFlags.map((f) => f.replace(/_/g, ' ')).join(', ')}.</p>}
        {e.reportDate && <p className="muted small">Report dated {fmtDate(e.reportDate)}. The file must be assembled within 60 days.</p>}
        <ErrorNote error={error} />
        {info && <Notice>{info}</Notice>}
        {blockers.length > 0 && (
          <div className="notice error" role="alert">
            This engagement cannot move to {STATE_LABELS[next!]} yet:
            <ul>{blockers.map((b) => <li key={b.gate}>{GATE_LABELS[b.gate] ?? b.message}</li>)}</ul>
          </div>
        )}
        {next && next !== 'locked' && canMove && (
          <div className="row">
            {next === 'report_issued' && (
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="rd">Report date</label>
                <input id="rd" type="date" value={reportDate} onChange={(e2) => setReportDate(e2.target.value)} />
              </div>
            )}
            <button onClick={move} disabled={(partnerOnly && me.userId !== e.partnerId) || (next === 'report_issued' && !reportDate)}>
              Move to {STATE_LABELS[next]}
            </button>
            {partnerOnly && me.userId !== e.partnerId && <span className="muted small">Only the engagement partner can do this step.</span>}
          </div>
        )}
        {e.state === 'locked' && <p className="muted">The file is locked. Nothing can be edited or deleted. Late information goes in as an addendum paper.</p>}
      </section>

      {e.state === 'locked' && (
        <section className="sheet stack">
          <h2>Unlocking</h2>
          <p className="muted">A partner asks with a reason. A different partner or quality officer on the engagement approves. Both confirm with their authenticator.</p>
          {me.role === 'partner' && (
            <form className="stack" onSubmit={(ev) => { ev.preventDefault(); void run(() => withStepUp(() => api.post(`/engagements/${e.id}/unlock-requests`, { reason: unlockReason })), 'Unlock requested.'); }}>
              <div className="field"><label htmlFor="ur">Reason for unlocking</label><input id="ur" required minLength={10} value={unlockReason} onChange={(e2) => setUnlockReason(e2.target.value)} /></div>
              <div><button>Request unlock</button></div>
            </form>
          )}
          {unlocks.data?.requests.length === 0 && <Empty>No unlock requests.</Empty>}
          <ul className="item-list">
            {unlocks.data?.requests.map((r) => (
              <li key={r.id}>
                <div>{r.reason}</div>
                <div className="small muted">Requested by {r.requestedByEmail} on {fmtDate(r.createdAt)}: {r.status}</div>
                {r.status === 'pending' && r.requestedBy !== me.userId && (me.role === 'partner' || me.role === 'quality_officer') && (
                  <button style={{ marginTop: '0.4rem' }} onClick={() => run(() => withStepUp(() => api.post(`/unlock-requests/${r.id}/approve`, {})), 'Engagement unlocked.')}>Approve unlock</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sheet stack">
        <h2>Team</h2>
        <table>
          <thead><tr><th>Person</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {team.data?.members.map((m) => (
              <tr key={m.userId}>
                <td>{m.fullName ?? m.email}</td>
                <td>{ROLE_LABELS[m.role] ?? m.role}</td>
                <td className="muted small">{m.userId === e.partnerId ? 'Engagement partner' : m.userId === e.eqrId ? 'Quality reviewer' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canMove && e.state !== 'locked' && (
          <form className="row" onSubmit={(ev) => { ev.preventDefault(); void run(() => api.post(`/engagements/${e.id}/members`, { userId: addId }), 'Added to the team.'); setAddId(''); }}>
            <div className="field" style={{ margin: 0, minWidth: '16rem' }}>
              <label htmlFor="am">Add to the team <span className="hint">they need a current independence declaration</span></label>
              <select id="am" required value={addId} onChange={(e2) => setAddId(e2.target.value)}>
                <option value="">Choose a person</option>
                {candidates.map((p) => <option key={p.id} value={p.id}>{p.fullName ?? p.email} ({ROLE_LABELS[p.role] ?? p.role})</option>)}
              </select>
            </div>
            <button className="secondary">Add</button>
          </form>
        )}
        {me.role === 'partner' && e.state !== 'locked' && (
          <form className="row" onSubmit={(ev) => { ev.preventDefault(); void run(() => api.post(`/engagements/${e.id}/eqr`, { userId: eqrId }), 'Quality reviewer assigned.'); }}>
            <div className="field" style={{ margin: 0, minWidth: '16rem' }}>
              <label htmlFor="eq">Engagement quality reviewer <span className="hint">not the engagement partner</span></label>
              <select id="eq" required value={eqrId} onChange={(e2) => setEqrId(e2.target.value)}>
                <option value="">Choose a reviewer</option>
                {people.data?.people.filter((p) => p.role === 'eqr' || (p.role === 'partner' && p.id !== e.partnerId)).map((p) => <option key={p.id} value={p.id}>{p.fullName ?? p.email}</option>)}
              </select>
            </div>
            <button className="secondary">Assign</button>
          </form>
        )}
      </section>
    </div>
  );
}
