'use client';
import { History as VersionHistory } from '@/components/History';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice, SignoffStrip, StateBadge, type SignoffView } from './bits';
import { useStepUp } from './StepUp';
import { TableScroll } from '@/components/ui/TableScroll';

export interface ItemDetail {
  id: string;
  engagementId: string;
  kind: string;
  title: string;
  state: string;
  version: number;
  contentHash: string;
  content: Record<string, unknown>;
  deleted: boolean;
  createdBy: string;
  signoffs: (SignoffView & { id: string })[];
  pendingDeletion: { id: string; requestedBy: string; reason: string } | null;
}
interface Note { id: string; raisedBy: string; text: string; status: string; response: string | null; createdAt: string }
interface History {
  versions: { version: number; title: string; editedAt: string; reason: string | null; contentHash: string }[];
  events: { seq: number; at: string; action: string }[];
  deletionRequests: { id: string; reason: string; status: string }[];
}

export interface Viewer { userId: string; role: string; engagementLocked: boolean }

const REVIEWERS = ['manager', 'partner', 'eqr', 'quality_officer'];

/** Everything about one working paper that is not its body: sign-offs, review notes, deletion and history. */
export function ItemPanel({
  itemId, viewer, onChanged, children,
}: {
  itemId: string;
  viewer: Viewer;
  onChanged?: () => void;
  children?: (item: ItemDetail, reload: () => void) => ReactNode;
}) {
  const item = useApi<ItemDetail>(`/items/${itemId}`);
  const notes = useApi<{ notes: Note[] }>(`/items/${itemId}/review-notes`);
  const [showHistory, setShowHistory] = useState(false);
  const history = useApi<History>(showHistory ? `/items/${itemId}/history` : null);
  const withStepUp = useStepUp();
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');
  const [noteText, setNoteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState<Record<string, string>>({});

  const d = item.data;
  const reload = () => {
    item.reload();
    notes.reload();
    history.reload();
    onChanged?.();
  };

  async function act(fn: () => Promise<unknown>, message = '') {
    setError(undefined);
    setInfo('');
    try {
      await fn();
      if (message) setInfo(message);
      reload();
    } catch (e) {
      if (e instanceof Error && e.message === 'cancelled') return;
      setError(e);
      reload();
    }
  }

  if (item.error) return <ErrorNote error={item.error} />;
  if (!d) return <p className="muted">Loading paper…</p>;

  const signoff = (level: 'prepared' | 'manager' | 'partner') =>
    act(() => withStepUp(() => api.post(`/items/${d.id}/signoff`, { level, expectedHash: d.contentHash })), 'Signed.');

  const canPrepare = d.state === 'draft';
  const canReview = d.state === 'prepared' && (viewer.role === 'manager' || viewer.role === 'partner');
  const canApprove = d.state === 'manager_reviewed' && (viewer.role === 'partner' || (viewer.role === 'eqr' && d.kind === 'eqr_review'));
  const openNotes = notes.data?.notes.filter((n) => n.status === 'open').length ?? 0;
  const locked = viewer.engagementLocked;

  return (
    <article className="sheet stack">
      <div className="sheet-head">
        <div>
          <h3>{d.title}</h3>
          <div className="row small muted">
            <span className="ref">{d.kind.replace(/_/g, ' ')}</span>
            <StateBadge state={d.state} />
            <span>Version {d.version}</span>
            {openNotes > 0 && <span className="state open">{openNotes} open {openNotes === 1 ? 'note' : 'notes'}</span>}
          </div>
        </div>
        <SignoffStrip signoffs={d.signoffs} />
      </div>

      {children?.(d, reload)}

      <ErrorNote error={error} />
      {info && <Notice>{info}</Notice>}

      {!locked && (
        <div className="row">
          {canPrepare && <button onClick={() => signoff('prepared')}>Sign as prepared</button>}
          {canReview && <button onClick={() => signoff('manager')}>Sign as reviewed</button>}
          {canApprove && <button onClick={() => signoff('partner')}>Approve</button>}
          {!d.pendingDeletion && <button className="danger" onClick={() => setDeleting(!deleting)}>Delete…</button>}
        </div>
      )}

      {deleting && !locked && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const r = await api.post<{ deleted: boolean }>(`/items/${d.id}/delete-request`, { reason });
              setDeleting(false);
              setReason('');
              setInfo(r.deleted ? 'Deleted. The paper stays in the history.' : 'Deletion requested. A more senior colleague has to approve it.');
            });
          }}
        >
          <div className="field">
            <label htmlFor={`del-${d.id}`}>Why is this paper being deleted? <span className="hint">Recorded in the activity history.</span></label>
            <input id={`del-${d.id}`} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="row"><button className="danger">Confirm deletion</button><button type="button" className="secondary" onClick={() => setDeleting(false)}>Keep paper</button></div>
        </form>
      )}

      {d.pendingDeletion && (
        <Notice kind="warn">
          Deletion requested: “{d.pendingDeletion.reason}”.{' '}
          {d.pendingDeletion.requestedBy === viewer.userId
            ? 'Someone else has to approve it.'
            : <button className="danger" onClick={() => act(() => withStepUp(() => api.post(`/deletion-requests/${d.pendingDeletion!.id}/approve`, {})), 'Deleted.')}>Approve deletion</button>}
        </Notice>
      )}

      <section aria-label="Review notes" className="stack">
        <h3>Review notes</h3>
        {notes.data?.notes.length === 0 && <p className="muted">No review notes.</p>}
        <ul className="item-list">
          {notes.data?.notes.map((n) => (
            <li key={n.id}>
              <div className="row between">
                <span>{n.text}</span>
                <StateBadge state={n.status} />
              </div>
              {n.response && <div className="small muted">Response: {n.response}</div>}
              {n.status === 'open' && REVIEWERS.includes(viewer.role) && !locked && (
                <div className="row" style={{ marginTop: '0.4rem' }}>
                  <input aria-label="Response" placeholder="How was it dealt with?" value={resolution[n.id] ?? ''} onChange={(e) => setResolution({ ...resolution, [n.id]: e.target.value })} style={{ maxWidth: '24rem' }} />
                  <button className="secondary" onClick={() => act(() => api.post(`/review-notes/${n.id}/clear`, { response: resolution[n.id] ?? '' }))}>Clear</button>
                  {(viewer.role === 'manager' || viewer.role === 'partner') && (
                    <button className="quiet" onClick={() => act(() => api.post(`/review-notes/${n.id}/accept`, { justification: resolution[n.id] ?? '' }))}>Accept as is</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {REVIEWERS.includes(viewer.role) && !locked && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.post(`/items/${d.id}/review-notes`, { text: noteText }); setNoteText(''); }); }}>
            <input aria-label="New review note" placeholder="Raise a point for the preparer" required value={noteText} onChange={(e) => setNoteText(e.target.value)} style={{ maxWidth: '30rem' }} />
            <button className="secondary">Raise note</button>
          </form>
        )}
      </section>

      <div>
        <button className="quiet" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide history' : 'Show history'}</button>
        {showHistory && history.data && (
          <div className="stack small">
            <VersionHistory itemId={d.id} canRestore={!locked && viewer.role !== 'quality_officer' && viewer.role !== 'eqr'} onRestored={reload} />
            <TableScroll label="Activity history list"><table>
              <thead><tr><th>Activity history</th><th>When</th></tr></thead>
              <tbody>{history.data.events.map((e) => <tr key={e.seq}><td>{e.action.replace(/^item\./, '').replace(/_/g, ' ')}</td><td>{new Date(e.at).toLocaleString('en-GB')}</td></tr>)}</tbody>
            </table></TableScroll>
          </div>
        )}
      </div>
    </article>
  );
}
