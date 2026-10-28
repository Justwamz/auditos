'use client';
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate } from '@/lib/text';
import { Empty, ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import type { Viewer } from '@/components/ItemPanel';
import { SectionHead } from '@/components/ui/SectionHead';
import { SidePanel } from '@/components/ui/SidePanel';
import type { Engagement } from '../page';

const kes = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

interface Progress { selected: number; pending: number; supported: number; exceptions: number; notTested: number; testedValue: string; misstatementFound: string; exceptionRate: string | null; projected: string | null; note: string; complete: boolean }
interface Schedule {
  id: string; title: string; objective: string | null; method: 'random' | 'monetary_unit' | 'top'; seed: string; requestedSize: number; populationCount: number;
  populationTotal: string; populationFingerprint: string; interval: string | null; createdBy: string; createdAt: string; progress?: Progress;
}
interface Item {
  id: string; position: number; ref: string; description: string; amount: string; reason: string; result: 'pending' | 'supported' | 'exception' | 'not_tested';
  misstatement: string | null; note: string | null; evidence: { id: string; title: string } | null; testedBy: string | null; testedAt: string | null;
}
interface Detail extends Schedule { summary: Progress; items: Item[] }

const METHODS = { random: 'Random', monetary_unit: 'Monetary-unit (by value)', top: 'Top items' } as const;
const REASONS: Record<string, string> = { random: 'Random', interval: 'Value interval', key_item: 'Key item (large)', top: 'Top item' };
const RESULTS = { pending: 'Not yet tested', supported: 'Supported', exception: 'Exception', not_tested: 'Not tested' } as const;

/** Sampling and vouching: draw a reproducible sample from a population, then record what testing each item found. */
export function Sampling({ engagement: e, viewer }: { engagement: Engagement; viewer: Viewer }) {
  const list = useApi<{ schedules: Schedule[] }>(`/engagements/${e.id}/sampling`);
  const [error, setError] = useState<unknown>();
  const [rows, setRows] = useState<{ row: number; message: string }[]>([]);
  const [openId, setOpenId] = useState<string>();
  const [method, setMethod] = useState<keyof typeof METHODS>('random');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const readOnly = viewer.engagementLocked;

  async function draw(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const data = new FormData(ev.currentTarget);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) return;
    setError(undefined);
    setRows([]);
    setBusy(true);
    // Text fields first, then the file, so the server has them when it reads the file.
    const fd = new FormData();
    for (const k of ['title', 'objective', 'method', 'size', 'seed']) fd.append(k, String(data.get(k) ?? ''));
    fd.append('file', file);
    try {
      const r = await api.upload<{ id: string }>(`/engagements/${e.id}/sampling`, fd);
      form.current?.reset();
      setPanel(false);
      list.reload();
      setOpenId(r.id);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.body.rows)) setRows(err.body.rows as { row: number; message: string }[]);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <SectionHead
        title="Sampling"
        sentence="Draw a sample that can be repeated, then record what testing each item found."
        help={<HelpLink topic="engagement.sampling" label="How sampling works" />}
        action={!readOnly ? <button type="button" className={openId ? 'secondary' : undefined} onClick={() => { setError(undefined); setRows([]); setPanel(true); }}>+ Draw a sample</button> : undefined}
      />
      {!readOnly && (
        <SidePanel
          open={panel}
          title="Draw a sample"
          onClose={() => { setPanel(false); setError(undefined); setRows([]); }}
          footer={
            <>
              <button type="button" className="quiet" onClick={() => { setPanel(false); setError(undefined); setRows([]); }}>Cancel</button>
              <button type="submit" form="sample-form" disabled={busy}>{busy ? 'Drawing…' : 'Draw sample'}</button>
            </>
          }
        >
          <form id="sample-form" className="stack" ref={form} onSubmit={draw}>
            <p className="muted">Upload everything the sample is drawn from (a CSV or Excel file with an Amount column, and ideally a Reference and a Description). The draw can be repeated: the seed, the method and a check code of the file are recorded.</p>
          <div className="stack">
            <div className="field"><label htmlFor="st">What is being tested</label><input id="st" name="title" required maxLength={200} placeholder="Trade payables at year end" /></div>
            <div className="field">
              <label htmlFor="sm">Method</label>
              <select id="sm" name="method" value={method} onChange={(ev) => setMethod(ev.target.value as keyof typeof METHODS)}>
                {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="ss">How many items</label><input id="ss" name="size" type="number" min={1} max={500} defaultValue={25} required /></div>
            <div className="field"><label htmlFor="sd">Seed (leave blank to make one)</label><input id="sd" name="seed" maxLength={80} autoComplete="off" /></div>
          </div>
          <div className="field"><label htmlFor="so">Objective (optional)</label><input id="so" name="objective" maxLength={500} placeholder="Existence and completeness of payables" /></div>
          <div className="field"><label htmlFor="sf">Population file</label><input id="sf" name="file" type="file" required accept=".csv,.xlsx" /></div>
          {method === 'top' && <Notice kind="warn">Top items are tested in full and are not a sample of the rest, so nothing is projected from them.</Notice>}
          <ErrorNote error={error} />
          {rows.length > 0 && <div className="notice error"><ul>{rows.slice(0, 20).map((r) => <li key={`${r.row}-${r.message}`}>Row {r.row}: {r.message}</li>)}</ul></div>}
          </form>
        </SidePanel>
      )}

      <section className="sheet stack">
        <h2>Sampling schedules</h2>
        {list.error ? <ErrorNote error={list.error} /> : !list.data ? <p className="muted">Loading…</p> : list.data.schedules.length === 0 ? (
          <Empty>No schedules yet. Use Draw a sample at the top to start one.</Empty>
        ) : (
          <table>
            <thead><tr><th>Schedule</th><th>Method</th><th className="num">Population</th><th className="num">Selected</th><th>Progress</th><th /></tr></thead>
            <tbody>
              {list.data.schedules.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}<br /><span className="muted">{s.createdBy}, {fmtDate(s.createdAt)}</span></td>
                  <td>{METHODS[s.method]}</td>
                  <td className="num">{s.populationCount} items<br />{kes(s.populationTotal)}</td>
                  <td className="num">{s.progress?.selected}</td>
                  <td>{s.progress ? `${s.progress.selected - s.progress.pending} of ${s.progress.selected} tested${s.progress.exceptions ? `, ${s.progress.exceptions} exception${s.progress.exceptions === 1 ? '' : 's'}` : ''}` : ''}</td>
                  <td><button className="secondary" onClick={() => setOpenId(openId === s.id ? undefined : s.id)}>{openId === s.id ? 'Close' : 'Open'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {openId && <ScheduleView key={openId} e={e} id={openId} readOnly={readOnly} onChanged={list.reload} onDeleted={() => { setOpenId(undefined); list.reload(); }} />}
    </div>
  );
}

function ScheduleView({ e, id, readOnly, onChanged, onDeleted }: { e: Engagement; id: string; readOnly: boolean; onChanged: () => void; onDeleted: () => void }) {
  const d = useApi<Detail>(`/engagements/${e.id}/sampling/${id}`);
  const evidence = useApi<{ items: { id: string; title: string }[] }>(`/engagements/${e.id}/items?kind=evidence`);
  const [error, setError] = useState<unknown>();
  if (d.error) return <ErrorNote error={d.error} />;
  if (!d.data) return <p className="muted">Loading…</p>;
  const s = d.data;

  async function discard() {
    setError(undefined);
    try { await api.del(`/engagements/${e.id}/sampling/${id}`); onDeleted(); } catch (err) { setError(err); }
  }

  return (
    <section className="sheet stack" aria-label={`Schedule ${s.title}`}>
      <h2>{s.title}</h2>
      <p className="muted">
        {METHODS[s.method]} · seed <code>{s.seed}</code> · {s.populationCount} items worth {kes(s.populationTotal)}{s.interval ? ` · interval ${kes(s.interval)}` : ''} · file check code <code>{s.populationFingerprint.slice(0, 12)}</code>
        {s.objective ? ` · ${s.objective}` : ''}
      </p>
      <div className="notice" role="status">
        <p>
          <strong>{s.summary.selected - s.summary.pending} of {s.summary.selected}</strong> tested: {s.summary.supported} supported, {s.summary.exceptions} exception{s.summary.exceptions === 1 ? '' : 's'}, {s.summary.notTested} not tested.
          {s.summary.exceptions > 0 && <> Misstatement found {kes(s.summary.misstatementFound)}; exception rate {s.summary.exceptionRate}.{s.summary.projected !== null && <> If the sample is representative, that suggests about <strong>{kes(s.summary.projected)}</strong> across the population.</>}</>}
        </p>
        <p className="muted">{s.summary.note}</p>
      </div>
      <ErrorNote error={error} />
      <table>
        <thead><tr><th>#</th><th>Reference</th><th>Description</th><th className="num">Amount</th><th>Why selected</th><th>Result</th></tr></thead>
        <tbody>
          {s.items.map((i) => (
            <ItemRow key={i.id} e={e} scheduleId={id} item={i} readOnly={readOnly} evidence={evidence.data?.items ?? []} onSaved={() => { d.reload(); onChanged(); }} />
          ))}
        </tbody>
      </table>
      {!readOnly && s.summary.pending === s.summary.selected && <div><button className="secondary" onClick={discard}>Discard this schedule and draw again</button></div>}
    </section>
  );
}

function ItemRow({ e, scheduleId, item, readOnly, evidence, onSaved }: { e: Engagement; scheduleId: string; item: Item; readOnly: boolean; evidence: { id: string; title: string }[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<Item['result']>(item.result === 'pending' ? 'supported' : item.result);
  const [misstatement, setMisstatement] = useState(item.misstatement ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [evidenceId, setEvidenceId] = useState(item.evidence?.id ?? '');
  const [error, setError] = useState<unknown>();

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    try {
      await api.patch(`/engagements/${e.id}/sampling/${scheduleId}/items/${item.id}`, {
        result, ...(result === 'exception' ? { misstatement } : {}), note, evidenceItemId: evidenceId || null,
      });
      setEditing(false);
      onSaved();
    } catch (err) { setError(err); }
  }

  return (
    <>
      <tr>
        <td>{item.position}</td><td>{item.ref}</td><td>{item.description}</td><td className="num">{kes(item.amount)}</td><td>{REASONS[item.reason] ?? item.reason}</td>
        <td>
          {RESULTS[item.result]}{item.result === 'exception' && item.misstatement ? ` (${kes(item.misstatement)})` : ''}
          {item.testedBy && <><br /><span className="muted">{item.testedBy}, {fmtDate(item.testedAt)}</span></>}
          {item.note && <><br /><span className="muted">{item.note}</span></>}
          {item.evidence && <><br /><span className="muted">Evidence: {item.evidence.title}</span></>}
          {!readOnly && !editing && <><br /><button className="secondary" onClick={() => setEditing(true)}>{item.result === 'pending' ? 'Record result' : 'Change result'}</button></>}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6}>
            <form className="stack" onSubmit={save} aria-label={`Result for ${item.ref}`}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor={`r-${item.id}`}>Result</label>
                  <select id={`r-${item.id}`} value={result} onChange={(ev) => setResult(ev.target.value as Item['result'])}>
                    <option value="supported">Supported</option><option value="exception">Exception</option><option value="not_tested">Not tested</option><option value="pending">Back to not yet tested</option>
                  </select>
                </div>
                {result === 'exception' && <div className="field"><label htmlFor={`m-${item.id}`}>Misstatement (KES)</label><input id={`m-${item.id}`} inputMode="decimal" required value={misstatement} onChange={(ev) => setMisstatement(ev.target.value)} /></div>}
                <div className="field">
                  <label htmlFor={`e-${item.id}`}>Evidence from the file</label>
                  <select id={`e-${item.id}`} value={evidenceId} onChange={(ev) => setEvidenceId(ev.target.value)}>
                    <option value="">None linked</option>
                    {evidence.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label htmlFor={`n-${item.id}`}>Note{result === 'exception' || result === 'not_tested' ? ' (required)' : ''}</label><textarea id={`n-${item.id}`} rows={2} required={result === 'exception' || result === 'not_tested'} value={note} onChange={(ev) => setNote(ev.target.value)} /></div>
              <ErrorNote error={error} />
              <div className="row"><button>Save result</button><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button></div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
