'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/bits';
import { SidePanel } from '@/components/ui/SidePanel';
import { SECTOR_LABELS } from '@/lib/text';
import type { Prospect } from '@/lib/pipeline';

export interface Person { id: string; fullName: string | null; email: string; role: string }
export type PanelMode = 'add' | 'lost' | 'handover' | 'convert';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FORM = 'prospect-panel-form';

/** The side panel behind every prospect form. `onDone(message)` runs after a save; `onClose` runs on cancel. */
export function ProspectPanel({
  mode, prospect, me, people, onDone, onClose,
}: {
  mode: PanelMode;
  prospect?: Prospect;
  me: { userId: string; role: string };
  people: Person[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const manager = me.role === 'manager' || me.role === 'partner';
  const [add, setAdd] = useState({ name: '', sector: 'trading', contactName: '', expectedFee: '', expectedStart: '', ownerId: '' });
  const [reason, setReason] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [conv, setConv] = useState({ legalForm: 'Limited company', yearEndMonth: 12, accountManagerId: '' });
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const p = prospect;

  async function run(fn: () => Promise<unknown>, message: string) {
    setError(undefined);
    setBusy(true);
    try {
      await fn();
      onDone(message);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    if (mode === 'add') {
      const body: Record<string, unknown> = { name: add.name, sector: add.sector };
      if (add.contactName.trim()) body.contactName = add.contactName;
      if (add.expectedFee.trim()) body.expectedFee = add.expectedFee;
      if (add.expectedStart) body.expectedStart = add.expectedStart;
      if (add.ownerId) body.ownerId = add.ownerId;
      void run(() => api.post('/prospects', body), `${add.name} added to your prospects.`);
    } else if (!p) {
      return;
    } else if (mode === 'lost') {
      void run(() => api.post(`/prospects/${p.id}/stage`, { stage: 'lost', reason }), `${p.name} marked as lost.`);
    } else if (mode === 'handover') {
      void run(() => api.post(`/prospects/${p.id}/owner`, { userId: newOwner, reason }), `${p.name} handed over.`);
    } else {
      void run(
        () => api.post(`/prospects/${p.id}/convert`, { legalForm: conv.legalForm, yearEndMonth: Number(conv.yearEndMonth), ...(conv.accountManagerId ? { accountManagerId: conv.accountManagerId } : {}) }),
        `${p.name} is now a client.`,
      );
    }
  }

  const title = mode === 'add' ? 'Add a prospect' : mode === 'lost' ? `Why was ${p?.name} lost?` : mode === 'handover' ? `Hand over ${p?.name}` : `Make ${p?.name} a client`;
  const action = mode === 'add' ? 'Add prospect' : mode === 'lost' ? 'Mark as lost' : mode === 'handover' ? 'Hand over' : 'Create the client';

  return (
    <SidePanel
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form={FORM} className={mode === 'lost' ? 'danger' : undefined} disabled={busy}>{action}</button>
        </>
      }
    >
      <form id={FORM} className="stack" onSubmit={submit}>
        {mode === 'add' && (
          <>
            <div className="field"><label htmlFor="pn">Name</label><input id="pn" required minLength={2} maxLength={200} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="ps">Sector</label>
              <select id="ps" value={add.sector} onChange={(e) => setAdd({ ...add, sector: e.target.value })}>{Object.entries(SECTOR_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="pc">Contact</label><input id="pc" maxLength={120} value={add.contactName} onChange={(e) => setAdd({ ...add, contactName: e.target.value })} /></div>
            <div className="field"><label htmlFor="pf">Expected fee (KES)</label><input id="pf" inputMode="decimal" placeholder="450000" value={add.expectedFee} onChange={(e) => setAdd({ ...add, expectedFee: e.target.value })} /></div>
            <div className="field"><label htmlFor="pd">Expected start</label><input id="pd" type="date" value={add.expectedStart} onChange={(e) => setAdd({ ...add, expectedStart: e.target.value })} /></div>
            {manager && (
              <div className="field">
                <label htmlFor="po">Owner</label>
                <select id="po" value={add.ownerId} onChange={(e) => setAdd({ ...add, ownerId: e.target.value })}>
                  <option value="">Me</option>
                  {people.filter((x) => x.id !== me.userId).map((x) => <option key={x.id} value={x.id}>{x.fullName ?? x.email}</option>)}
                </select>
              </div>
            )}
          </>
        )}
        {mode === 'lost' && (
          <div className="field">
            <label htmlFor="pl">Why was it lost?</label>
            <input id="pl" required minLength={5} placeholder="For example: chose a firm closer to their office" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {mode === 'handover' && (
          <>
            <div className="field">
              <label htmlFor="pw">New owner</label>
              <select id="pw" required value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
                <option value="">Choose a person</option>
                {people.filter((x) => x.id !== p?.ownerId).map((x) => <option key={x.id} value={x.id}>{x.fullName ?? x.email}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="pr">Why? (recorded)</label><input id="pr" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </>
        )}
        {mode === 'convert' && (
          <>
            <div className="field"><label htmlFor="cl">Legal form</label><input id="cl" required value={conv.legalForm} onChange={(e) => setConv({ ...conv, legalForm: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="cy">Year end</label>
              <select id="cy" value={conv.yearEndMonth} onChange={(e) => setConv({ ...conv, yearEndMonth: Number(e.target.value) })}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m} year end</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ca">Account manager</label>
              <select id="ca" value={conv.accountManagerId} onChange={(e) => setConv({ ...conv, accountManagerId: e.target.value })}>
                <option value="">Account manager: me</option>
                {people.filter((x) => (x.role === 'manager' || x.role === 'partner') && x.id !== me.userId).map((x) => <option key={x.id} value={x.id}>{x.fullName ?? x.email}</option>)}
              </select>
            </div>
            <p className="small muted">The prospect becomes a client. You then open an engagement for it from Engagements.</p>
          </>
        )}
        <ErrorNote error={error} />
      </form>
    </SidePanel>
  );
}
