'use client';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, StateBadge } from '@/components/bits';
import { ItemPanel, type Viewer } from '@/components/ItemPanel';
import type { Engagement } from '../page';

interface Row { id: string; kind: string; title: string; state: string; version: number }

const KINDS: { id: string; label: string }[] = [
  { id: 'acceptance', label: 'Client acceptance' },
  { id: 'engagement_letter', label: 'Engagement letter' },
  { id: 'materiality', label: 'Materiality' },
  { id: 'risk_assessment', label: 'Risk assessment' },
  { id: 'workpaper', label: 'Working paper' },
  { id: 'eqr_review', label: 'Quality review' },
  { id: 'addendum', label: 'Addendum (after locking)' },
];
const HIDDEN = ['checklist', 'evidence', 'trial_balance', 'trial_balance_prior', 'fs_mapping', 'adjustments', 'fs_note'];

function Body({ itemId, content, state, locked, onSaved }: { itemId: string; content: Record<string, unknown>; state: string; locked: boolean; onSaved: () => void }) {
  const [notes, setNotes] = useState(String(content.notes ?? ''));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    setSaved(false);
    try {
      await api.patch(`/items/${itemId}`, { content: { ...content, notes }, ...(reason ? { reason } : {}) });
      setSaved(true);
      setReason('');
      onSaved();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      <div className="field">
        <label htmlFor={`n-${itemId}`}>Notes and conclusions</label>
        <textarea id={`n-${itemId}`} readOnly={locked} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {state === 'partner_approved' && !locked && (
        <div className="field">
          <label htmlFor={`r-${itemId}`}>Reason for changing an approved paper <span className="hint">Partner only. This removes the reviews and is recorded.</span></label>
          <input id={`r-${itemId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {state === 'manager_reviewed' && !locked && <p className="muted small">Saving changes will remove the review and send the paper back for review.</p>}
      <ErrorNote error={error} />
      {saved && <p className="small muted">Saved as a new version.</p>}
      {!locked && <div><button className="secondary">Save changes</button></div>}
    </form>
  );
}

export function Papers({ engagement: e, viewer, focusItem }: { engagement: Engagement; viewer: Viewer; focusItem: string | null }) {
  const list = useApi<{ items: Row[] }>(`/engagements/${e.id}/items`);
  const [open, setOpen] = useState<string | null>(focusItem);
  const [form, setForm] = useState({ kind: 'workpaper', title: '', addendumOf: '' });
  const [error, setError] = useState<unknown>();

  const rows = list.data?.items.filter((i) => !HIDDEN.includes(i.kind)) ?? [];

  async function create(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    try {
      const r = await api.post<{ id: string }>(`/engagements/${e.id}/items`, {
        kind: form.kind,
        title: form.title,
        content: { notes: '' },
        ...(form.kind === 'addendum' && form.addendumOf ? { addendumOf: form.addendumOf } : {}),
      });
      setForm({ ...form, title: '' });
      setOpen(r.id);
      list.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack-lg">
      {(
        <form className="sheet stack" onSubmit={create}>
          <h2>Add a working paper</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pk">Type</label>
              <select id="pk" value={form.kind} onChange={(ev) => setForm({ ...form, kind: ev.target.value })}>
                {KINDS.filter((k) => (viewer.engagementLocked ? k.id === 'addendum' : k.id !== 'addendum')).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="pt">Title</label><input id="pt" required maxLength={300} value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} /></div>
            {form.kind === 'addendum' && (
              <div className="field">
                <label htmlFor="pa">Paper this adds to</label>
                <select id="pa" required value={form.addendumOf} onChange={(ev) => setForm({ ...form, addendumOf: ev.target.value })}>
                  <option value="">Choose a paper</option>
                  {rows.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>
            )}
          </div>
          <ErrorNote error={error} />
          <div><button>Add paper</button></div>
        </form>
      )}

      <section className="stack">
        <h2>Papers on this engagement</h2>
        <ErrorNote error={list.error} />
        {list.data && rows.length === 0 && <Empty>No papers yet. Start with the client acceptance and the engagement letter.</Empty>}
        {rows.length > 0 && (
          <table>
            <thead><tr><th>Paper</th><th>Type</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td><td>{KINDS.find((k) => k.id === r.kind)?.label ?? r.kind.replace(/_/g, ' ')}</td>
                  <td><StateBadge state={r.state} /></td>
                  <td className="right"><button className="quiet" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Close' : 'Open'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {open && (
          <ItemPanel key={open} itemId={open} viewer={viewer} onChanged={list.reload}>
            {(item, reload) => <Body itemId={item.id} content={item.content} state={item.state} locked={viewer.engagementLocked} onSaved={reload} />}
          </ItemPanel>
        )}
      </section>
    </div>
  );
}
