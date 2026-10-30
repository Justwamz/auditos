'use client';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, Notice, StateBadge } from '@/components/bits';
import type { Viewer } from '@/components/ItemPanel';
import type { Engagement } from '../page';
import { TableScroll } from '@/components/ui/TableScroll';

interface Row { id: string; title: string; state: string; createdAt: string }
interface Detail { content: { sha256: string; size: number; scanStatus: string; parentItemId?: string } }

function EvidenceRow({ row }: { row: Row }) {
  const d = useApi<Detail>(`/items/${row.id}`);
  const c = d.data?.content;
  return (
    <tr>
      <td>{row.title}</td>
      <td className="num">{c ? `${(c.size / 1024).toFixed(1)} KB` : ''}</td>
      <td className="small mono" title={c ? 'Reference code of the file as saved' : undefined}>{c ? c.sha256.slice(0, 12) : ''}</td>
      <td>{c?.scanStatus === 'clean' ? 'Passed' : c ? <span className="state open">Failed the virus check</span> : ''}</td>
      <td><StateBadge state={row.state} /></td>
      <td className="right">{c?.scanStatus === 'clean' && <a href={`/api/evidence/${row.id}/download`}>Download</a>}</td>
    </tr>
  );
}

export function Evidence({ engagement: e, viewer }: { engagement: Engagement; viewer: Viewer }) {
  const list = useApi<{ items: Row[] }>(`/engagements/${e.id}/items?kind=evidence`);
  const papers = useApi<{ items: { id: string; title: string; kind: string }[] }>(`/engagements/${e.id}/items`);
  const [parent, setParent] = useState('');
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function upload(ev: FormEvent) {
    ev.preventDefault();
    const f = file.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    setError(undefined);
    setInfo('');
    const fd = new FormData();
    if (parent) fd.append('itemId', parent);
    fd.append('file', f);
    try {
      const r = await api.upload<{ name: string; sha256: string; scanStatus: string }>(`/engagements/${e.id}/evidence`, fd);
      setInfo(r.scanStatus === 'clean' ? `${r.name}: saved and checked. Reference ${r.sha256.slice(0, 12)}.` : `${r.name}: saved, but it failed the virus check and cannot be downloaded.`);
      if (file.current) file.current.value = '';
      list.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      {!viewer.engagementLocked && (
        <form className="sheet stack" onSubmit={upload}>
          <h2>Upload evidence</h2>
          <p className="muted">PDF, PNG, JPG, XLSX, DOCX, CSV or TXT up to 25 MB. Every file is checked for viruses and kept exactly as it was uploaded.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="ef">File</label><input id="ef" type="file" ref={file} required accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.csv,.txt" /></div>
            <div className="field">
              <label htmlFor="ep2">Supports this paper <span className="hint">optional</span></label>
              <select id="ep2" value={parent} onChange={(ev) => setParent(ev.target.value)}>
                <option value="">Not linked</option>
                {papers.data?.items.filter((p) => p.kind !== 'evidence').map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          </div>
          <ErrorNote error={error} />
          {info && <Notice>{info}</Notice>}
          <div><button disabled={busy}>{busy ? 'Uploading…' : 'Upload file'}</button></div>
        </form>
      )}
      <section className="sheet stack">
        <h2>Files on this engagement</h2>
        <ErrorNote error={list.error} />
        {list.data && list.data.items.length === 0 && <Empty>No evidence uploaded yet.</Empty>}
        {list.data && list.data.items.length > 0 && (
          <TableScroll label="Evidence files"><table>
            <thead><tr><th>File</th><th className="num">Size</th><th>Reference</th><th>Virus check</th><th>Status</th><th></th></tr></thead>
            <tbody>{list.data.items.map((r) => <EvidenceRow key={r.id} row={r} />)}</tbody>
          </table></TableScroll>
        )}
      </section>
    </div>
  );
}
