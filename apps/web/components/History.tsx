'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';
import { TableScroll } from '@/components/ui/TableScroll';

interface Version { version: number; title: string; editedByName: string | null; at: string; reason: string | null; contentHash: string }
interface Change { path: string; before: unknown; after: unknown }

const show = (v: unknown): string => (v === undefined ? '(nothing)' : typeof v === 'string' ? v : JSON.stringify(v));
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Every saved version of a paper, who saved it and why, what changed, and a way to go back (as a new version). */
export function History({ itemId, canRestore, onRestored }: { itemId: string; canRestore: boolean; onRestored: () => void }) {
  const versions = useApi<{ versions: Version[] }>(`/items/${itemId}/versions`);
  const [open, setOpen] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const changes = useApi<{ changes: Change[] }>(open === null ? null : `/items/${itemId}/versions/${open}/changes`);

  async function restore(version: number) {
    setError(undefined);
    try {
      await api.post(`/items/${itemId}/restore`, { version, reason });
      setRestoring(null);
      setReason('');
      versions.reload();
      onRestored();
    } catch (e) {
      setError(e);
    }
  }

  if (versions.error) return <ErrorNote error={versions.error} />;
  if (!versions.data) return <p className="muted small">Loading history…</p>;
  const newest = versions.data.versions[0]?.version;

  return (
    <div className="stack small">
      <p className="muted">Every version is kept for good. Going back creates a new version; nothing is erased.</p>
      <ErrorNote error={error} />
      <TableScroll label="Versions"><table>
        <thead><tr><th>Version</th><th>Saved by</th><th>When</th><th>Reason</th><th /></tr></thead>
        <tbody>
          {versions.data.versions.map((v) => (
            <tr key={v.version}>
              <td>{v.version}</td>
              <td>{v.editedByName ?? 'Unknown'}</td>
              <td>{when(v.at)}</td>
              <td>{v.reason ?? ''}</td>
              <td>
                <div className="row">
                  <button className="quiet" onClick={() => setOpen(open === v.version ? null : v.version)}>{open === v.version ? 'Hide changes' : 'What changed'}</button>
                  {canRestore && v.version !== newest && <button className="quiet" onClick={() => setRestoring(restoring === v.version ? null : v.version)}>Go back to this</button>}
                </div>
                {open === v.version && changes.data && (
                  <ul className="changes">
                    {changes.data.changes.length === 0 && <li>No change in the content.</li>}
                    {changes.data.changes.map((c) => (
                      <li key={c.path}>
                        <strong>{c.path}</strong>: <del>{show(c.before)}</del> → <ins>{show(c.after)}</ins>
                      </li>
                    ))}
                  </ul>
                )}
                {restoring === v.version && (
                  <form className="row" onSubmit={(e) => { e.preventDefault(); void restore(v.version); }} style={{ marginTop: '0.3rem' }}>
                    <input aria-label={`Reason for going back to version ${v.version}`} placeholder="Why go back? (recorded)" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
                    <button className="secondary">Go back</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></TableScroll>
    </div>
  );
}
