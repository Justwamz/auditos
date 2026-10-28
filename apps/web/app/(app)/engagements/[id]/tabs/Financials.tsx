'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote, Notice } from '@/components/bits';
import type { Viewer } from '@/components/ItemPanel';
import { useStepUp } from '@/components/StepUp';
import { fmtCents } from '@/lib/text';
import { SectionHead } from '@/components/ui/SectionHead';
import { SidePanel } from '@/components/ui/SidePanel';
import type { Engagement } from '../page';

type Section = 'tb' | 'mapping' | 'adjustments' | 'statements' | 'notes' | 'export';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'tb', label: 'Trial balance' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'adjustments', label: 'Adjustments' },
  { id: 'statements', label: 'Statements' },
  { id: 'notes', label: 'Notes and disclosures' },
  { id: 'export', label: 'Export' },
];

interface TbLine { code: string; name: string; debit: string; credit: string }
interface RowErr { row: number; message: string }

function TrialBalance({ e, viewer }: { e: Engagement; viewer: Viewer }) {
  const cur = useApi<{ lines: TbLine[]; version: number }>(`/engagements/${e.id}/tb`);
  const prior = useApi<{ lines: TbLine[]; version: number }>(`/engagements/${e.id}/tb?prior=true`);
  const [isPrior, setIsPrior] = useState(false);
  const [panel, setPanel] = useState(false);
  const [error, setError] = useState<unknown>();
  const [rows, setRows] = useState<RowErr[]>([]);
  const [info, setInfo] = useState('');
  const file = useRef<HTMLInputElement>(null);

  async function upload(ev: FormEvent) {
    ev.preventDefault();
    const f = file.current?.files?.[0];
    if (!f) return;
    setError(undefined);
    setRows([]);
    setInfo('');
    const fd = new FormData();
    if (isPrior) fd.append('prior', 'true');
    fd.append('file', f);
    try {
      const r = await api.upload<{ rows: number; totalDebit: string; totalCredit: string; balanced: boolean }>(`/engagements/${e.id}/tb/import`, fd);
      setInfo(`Imported ${r.rows} accounts. Debits ${r.totalDebit}, credits ${r.totalCredit}${r.balanced ? '.' : '. They do not balance yet.'}`);
      if (file.current) file.current.value = '';
      setPanel(false);
      cur.reload();
      prior.reload();
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.body.rows)) setRows(err.body.rows as RowErr[]);
      setError(err);
    }
  }

  const show = (lines: TbLine[], title: string) => (
    <section className="sheet">
      <h3>{title}</h3>
      {lines.length === 0 ? <Empty>Nothing imported yet.</Empty> : (
        <table>
          <thead><tr><th>Code</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.code}><td>{l.code}</td><td>{l.name}</td><td className="num">{l.debit}</td><td className="num">{l.credit}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );

  return (
    <div className="stack">
      <SectionHead
        title="Trial balance"
        sentence="The year's account balances, as the client gave them. Importing again replaces them as a new version."
        action={!viewer.engagementLocked ? <button type="button" onClick={() => { setError(undefined); setRows([]); setPanel(true); }}>+ Import a trial balance</button> : undefined}
      />
      {info && <Notice>{info}</Notice>}
      {!viewer.engagementLocked && (
        <SidePanel
          open={panel}
          title="Import a trial balance"
          onClose={() => setPanel(false)}
          footer={
            <>
              <button type="button" className="quiet" onClick={() => setPanel(false)}>Cancel</button>
              <button type="submit" form="tb-import-form">Import</button>
            </>
          }
        >
          <form id="tb-import-form" className="stack" onSubmit={upload}>
            <p className="muted">A CSV or XLSX file with the columns code, name, debit, credit. Amounts must be plain numbers with at most two decimals. Formulas are not accepted. Importing again replaces the trial balance as a new version and removes any reviews.</p>
            <div className="field"><label htmlFor="tbf">File</label><input id="tbf" type="file" ref={file} required accept=".csv,.xlsx" /></div>
            <label className="row check-row"><input type="checkbox" checked={isPrior} onChange={(ev) => setIsPrior(ev.target.checked)} /> This is last year’s trial balance (comparatives)</label>
            <ErrorNote error={error} />
            {rows.length > 0 && <div className="notice error"><ul>{rows.slice(0, 20).map((r) => <li key={`${r.row}-${r.message}`}>Row {r.row}: {r.message}</li>)}</ul>{rows.length > 20 && <p>…and {rows.length - 20} more.</p>}</div>}
          </form>
        </SidePanel>
      )}
      {cur.data && show(cur.data.lines, `Current year (version ${cur.data.version})`)}
      {prior.data && prior.data.lines.length > 0 && show(prior.data.lines, 'Prior year')}
    </div>
  );
}

function Mapping({ e, viewer }: { e: Engagement; viewer: Viewer }) {
  const m = useApi<{ mapping: Record<string, string>; unmapped: string[]; suggestions: Record<string, string>; taxonomy: { id: string; label: string; statement: string }[] }>(`/engagements/${e.id}/mapping`);
  const tb = useApi<{ lines: TbLine[] }>(`/engagements/${e.id}/tb`);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');

  useEffect(() => { if (m.data) setDraft(m.data.mapping); }, [m.data]);

  async function save() {
    setError(undefined);
    setInfo('');
    const clean = Object.fromEntries(Object.entries(draft).filter(([, v]) => v));
    try {
      await api.put(`/engagements/${e.id}/mapping`, { mapping: clean });
      setInfo('Mapping saved.');
      m.reload();
    } catch (err) {
      setError(err);
    }
  }
  const groups = { sofp: 'Financial position', pl: 'Profit or loss', equity: 'Equity movements' } as Record<string, string>;

  if (!tb.data || tb.data.lines.length === 0) return <Empty>Import a trial balance first.</Empty>;
  return (
    <section className="sheet stack">
      <h2>Map accounts to statement lines</h2>
      <p className="muted">Each account has to land on a line of the financial statements. The mapping is reused next year.</p>
      <div className="row">
        <button className="secondary" onClick={() => setDraft({ ...draft, ...(m.data?.suggestions ?? {}) })} disabled={!m.data || Object.keys(m.data.suggestions).length === 0}>Fill in suggestions</button>
        <span className="muted small">{tb.data.lines.filter((l) => !draft[l.code]).length} accounts not mapped</span>
      </div>
      <table>
        <thead><tr><th>Code</th><th>Account</th><th>Statement line</th></tr></thead>
        <tbody>
          {tb.data.lines.map((l) => (
            <tr key={l.code}>
              <td>{l.code}</td><td>{l.name}</td>
              <td>
                <select aria-label={`Statement line for ${l.name}`} value={draft[l.code] ?? ''} disabled={viewer.engagementLocked} onChange={(ev) => setDraft({ ...draft, [l.code]: ev.target.value })}>
                  <option value="">Not mapped</option>
                  {Object.entries(groups).map(([k, label]) => (
                    <optgroup key={k} label={label}>
                      {m.data?.taxonomy.filter((t) => t.statement === k).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </optgroup>
                  ))}
                </select>
                {!draft[l.code] && m.data?.suggestions[l.code] && <span className="small muted"> Suggested: {m.data.taxonomy.find((t) => t.id === m.data!.suggestions[l.code])?.label}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorNote error={error} />
      {info && <Notice>{info}</Notice>}
      {!viewer.engagementLocked && <div><button onClick={save}>Save mapping</button></div>}
    </section>
  );
}

interface Entry { id: string; description: string; status: string; lines: { code: string; debit: string; credit: string }[] }

function Adjustments({ e, viewer }: { e: Engagement; viewer: Viewer }) {
  const list = useApi<{ entries: Entry[]; unadjustedTotal: string }>(`/engagements/${e.id}/adjustments`);
  const tb = useApi<{ lines: TbLine[] }>(`/engagements/${e.id}/tb`);
  const [form, setForm] = useState({ description: '', status: 'proposed', lines: [{ code: '', debit: '', credit: '' }, { code: '', debit: '', credit: '' }] });
  const [error, setError] = useState<unknown>();
  const [panel, setPanel] = useState(false);
  const canAgree = viewer.role === 'manager' || viewer.role === 'partner';

  async function add(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    try {
      await api.post(`/engagements/${e.id}/adjustments`, { ...form, lines: form.lines.map((l) => ({ code: l.code, debit: l.debit || '0', credit: l.credit || '0' })) });
      setForm({ ...form, description: '', lines: [{ code: '', debit: '', credit: '' }, { code: '', debit: '', credit: '' }] });
      setPanel(false);
      list.reload();
    } catch (err) {
      setError(err);
    }
  }
  const setLine = (i: number, patch: Partial<{ code: string; debit: string; credit: string }>) =>
    setForm({ ...form, lines: form.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });

  async function setStatus(id: string, status: string) {
    setError(undefined);
    try { await api.patch(`/engagements/${e.id}/adjustments/${id}`, { status }); list.reload(); } catch (err) { setError(err); }
  }

  return (
    <div className="stack">
      <SectionHead
        title="Adjusting entries"
        sentence="Only entries marked agreed change the statements. Unadjusted entries are tracked for the summary of unadjusted misstatements."
        action={!viewer.engagementLocked ? <button type="button" onClick={() => { setError(undefined); setPanel(true); }}>+ Record an entry</button> : undefined}
      />
      {!viewer.engagementLocked && (
        <SidePanel
          open={panel}
          title="Record an adjusting entry"
          onClose={() => setPanel(false)}
          footer={
            <>
              <button type="button" className="quiet" onClick={() => setPanel(false)}>Cancel</button>
              <button type="submit" form="adjust-form">Record entry</button>
            </>
          }
        >
          <form id="adjust-form" className="stack" onSubmit={add}>
          <div className="form-grid">
            <div className="field"><label htmlFor="ad">Description</label><input id="ad" required value={form.description} onChange={(ev) => setForm({ ...form, description: ev.target.value })} /></div>
            <div className="field">
              <label htmlFor="as">Status</label>
              <select id="as" value={form.status} onChange={(ev) => setForm({ ...form, status: ev.target.value })}>
                <option value="proposed">Proposed</option>
                <option value="agreed" disabled={!canAgree}>Agreed</option>
                <option value="unadjusted">Unadjusted</option>
              </select>
            </div>
          </div>
          {form.lines.map((l, i) => (
            <div className="form-grid" key={i}>
              <div className="field">
                <label htmlFor={`al${i}`}>Account</label>
                <select id={`al${i}`} required value={l.code} onChange={(ev) => setLine(i, { code: ev.target.value })}>
                  <option value="">Choose an account</option>
                  {tb.data?.lines.map((t) => <option key={t.code} value={t.code}>{t.code} {t.name}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor={`ad${i}`}>Debit</label><input id={`ad${i}`} inputMode="decimal" value={l.debit} onChange={(ev) => setLine(i, { debit: ev.target.value, credit: '' })} /></div>
              <div className="field"><label htmlFor={`ac${i}`}>Credit</label><input id={`ac${i}`} inputMode="decimal" value={l.credit} onChange={(ev) => setLine(i, { credit: ev.target.value, debit: '' })} /></div>
            </div>
          ))}
          <div className="row"><button type="button" className="quiet" onClick={() => setForm({ ...form, lines: [...form.lines, { code: '', debit: '', credit: '' }] })}>Add a line</button></div>
          <ErrorNote error={error} />
          </form>
        </SidePanel>
      )}
      <section className="sheet stack">
        {list.data && list.data.entries.length === 0 && <Empty>No entries yet.</Empty>}
        {list.data && list.data.unadjustedTotal !== '0.00' && <Notice kind="warn">Unadjusted misstatements total {list.data.unadjustedTotal} (debit side).</Notice>}
        {list.data?.entries.map((en) => (
          <div key={en.id}>
            <div className="row between"><strong>{en.description}</strong>
              <select aria-label={`Status of ${en.description}`} value={en.status} disabled={!canAgree || viewer.engagementLocked} onChange={(ev) => setStatus(en.id, ev.target.value)} style={{ width: 'auto' }}>
                <option value="proposed">Proposed</option><option value="agreed">Agreed</option><option value="unadjusted">Unadjusted</option>
              </select>
            </div>
            <table><tbody>{en.lines.map((l, i) => <tr key={i}><td>{l.code}</td><td className="num">{l.debit !== '0.00' ? l.debit : ''}</td><td className="num">{l.credit !== '0.00' ? l.credit : ''}</td></tr>)}</tbody></table>
          </div>
        ))}
        {!panel && <ErrorNote error={error} />}
      </section>
    </div>
  );
}

interface Row { id: string; label: string; current: string; prior?: string; subtotal?: boolean }
interface Statements {
  hasComparatives: boolean;
  periodEnd: string;
  sofp: { sections: { id: string; label: string; rows: Row[]; total: string; priorTotal?: string }[]; totalAssets: string; totalEquityAndLiabilities: string; priorTotalAssets?: string; priorTotalEquityAndLiabilities?: string };
  pl: { rows: Row[]; profit: string };
  equity: { rows: { id: string; label: string; values: Record<string, string> }[] };
  cashflow?: { rows: Row[]; netMovement: string; openingCash: string; closingCash: string };
  notes: { id: string; title: string; rows: Row[] }[];
}
interface StatementsResponse {
  ok: boolean;
  draft: boolean;
  frameworkVersion: string;
  statements?: Statements;
  exceptions?: { code: string; message: string }[];
  blockers?: { code: string; message: string; detail?: unknown }[];
  disclosures?: { id: string; ref: string; text: string; satisfied: boolean; noteId?: string }[];
}

function Cells({ r, cmp, cls = '' }: { r: Row; cmp: boolean; cls?: string }) {
  return (
    <tr className={cls}>
      <td>{r.label}</td><td className="num">{fmtCents(r.current)}</td>{cmp && <td className="num">{fmtCents(r.prior)}</td>}
    </tr>
  );
}

function StatementsView({ s, framework }: { s: Statements; framework: string }) {
  const cmp = s.hasComparatives;
  const year = Number(s.periodEnd.slice(0, 4));
  const head = (title: string) => (
    <thead><tr><th scope="col">{title}</th><th className="num" scope="col">{year}</th>{cmp && <th className="num" scope="col">{year - 1}</th>}</tr></thead>
  );
  return (
    <div className="stack-lg">
      <p className="muted small">Prepared under {framework.replace('IFRS_SME_', 'IFRS for SMEs, ').replace('2E', '2nd edition').replace('3E', '3rd edition')}.</p>
      <table className="ledger">
        {head('Statement of financial position')}
        <tbody>
          {s.sofp.sections.filter((x) => x.rows.length > 0).map((sec) => (
            <FragmentRows key={sec.id}>
              <tr className="group"><td colSpan={cmp ? 3 : 2}>{sec.label}</td></tr>
              {sec.rows.map((r) => <Cells key={r.id} r={r} cmp={cmp} />)}
              <tr className="sub"><td>Total {sec.label.toLowerCase()}</td><td className="num">{fmtCents(sec.total)}</td>{cmp && <td className="num">{fmtCents(sec.priorTotal)}</td>}</tr>
              {sec.id === 'current_assets' && <tr className="grand"><td>Total assets</td><td className="num">{fmtCents(s.sofp.totalAssets)}</td>{cmp && <td className="num">{fmtCents(s.sofp.priorTotalAssets)}</td>}</tr>}
            </FragmentRows>
          ))}
          <tr className="grand"><td>Total equity and liabilities</td><td className="num">{fmtCents(s.sofp.totalEquityAndLiabilities)}</td>{cmp && <td className="num">{fmtCents(s.sofp.priorTotalEquityAndLiabilities)}</td>}</tr>
        </tbody>
      </table>

      <table className="ledger">
        {head('Statement of profit or loss')}
        <tbody>
          {s.pl.rows.map((r) => <Cells key={r.id} r={r} cmp={cmp} cls={r.id === 'profit' ? 'grand' : r.subtotal ? 'sub' : ''} />)}
        </tbody>
      </table>

      <table className="ledger">
        <thead><tr><th scope="col">Statement of changes in equity</th><th className="num" scope="col">Share capital</th><th className="num" scope="col">Reserves</th><th className="num" scope="col">Retained earnings</th><th className="num" scope="col">Total</th></tr></thead>
        <tbody>
          {s.equity.rows.map((r) => (
            <tr key={r.id} className={r.id === 'closing' ? 'grand' : ''}>
              <td>{r.label}</td>
              {(['share_capital', 'other_reserves', 'retained_earnings', 'total'] as const).map((k) => <td key={k} className="num">{fmtCents(r.values[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      {s.cashflow ? (
        <table className="ledger">
          <thead><tr><th scope="col">Statement of cash flows</th><th className="num" scope="col">{year}</th></tr></thead>
          <tbody>
            {s.cashflow.rows.map((r) => <tr key={r.id} className={r.subtotal ? 'sub' : ''}><td>{r.label}</td><td className="num">{fmtCents(r.current)}</td></tr>)}
            <tr className="sub"><td>Net movement in cash and cash equivalents</td><td className="num">{fmtCents(s.cashflow.netMovement)}</td></tr>
            <tr><td>At start of year</td><td className="num">{fmtCents(s.cashflow.openingCash)}</td></tr>
            <tr className="grand"><td>At end of year</td><td className="num">{fmtCents(s.cashflow.closingCash)}</td></tr>
          </tbody>
        </table>
      ) : <Notice kind="warn">The cash flow statement needs last year’s trial balance.</Notice>}

      {s.notes.filter((n) => n.rows.length > 0).map((n) => (
        <table className="ledger" key={n.id}>
          {head(`Note: ${n.title}`)}
          <tbody>{n.rows.map((r) => <Cells key={r.id} r={r} cmp={cmp} />)}</tbody>
        </table>
      ))}
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Statements({ e, onData }: { e: Engagement; onData?: (d: StatementsResponse) => void }) {
  const res = useApi<StatementsResponse>(`/engagements/${e.id}/statements`);
  useEffect(() => { if (res.data && onData) onData(res.data); }, [res.data, onData]);
  const d = res.data;
  return (
    <section className="sheet stack">
      <div className="row between"><h2>Draft financial statements</h2><button className="secondary" onClick={res.reload}>Refresh</button></div>
      <ErrorNote error={res.error} />
      {d && !d.ok && (
        <div className="notice error" role="alert">
          The statements cannot be produced yet:
          <ul>{d.blockers?.map((b, i) => <li key={i}>{b.code === 'empty' ? 'There is no trial balance, or every balance is zero.' : b.code === 'unbalanced' ? `Debits and credits differ (${JSON.stringify((b.detail as { difference?: string } | undefined)?.difference ?? '')} cents).` : b.code === 'unmapped' ? `${b.message}: ${Array.isArray(b.detail) ? (b.detail as { code: string; name: string }[]).map((x) => `${x.code} ${x.name}`).join(', ') : ''}` : b.message}</li>)}</ul>
        </div>
      )}
      {d?.ok && d.statements && (
        <>
          {d.draft && <Notice kind="warn">Draft: not approved for issue. Exports carry a DRAFT mark until the partner approves the engagement.</Notice>}
          {d.exceptions && d.exceptions.length > 0 && (
            <details className="notice warn"><summary>{d.exceptions.length} points for the preparer to review</summary><ul>{d.exceptions.map((x, i) => <li key={i}>{x.message}</li>)}</ul></details>
          )}
          <StatementsView s={d.statements} framework={d.frameworkVersion} />
        </>
      )}
    </section>
  );
}

function Notes({ e, viewer }: { e: Engagement; viewer: Viewer }) {
  const res = useApi<StatementsResponse>(`/engagements/${e.id}/statements`);
  const [text, setText] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();
  const d = res.data;

  async function save(noteId: string, title: string) {
    setError(undefined);
    try { await api.post(`/engagements/${e.id}/fs-notes`, { noteId, title, text: text[noteId] ?? '' }); res.reload(); } catch (err) { setError(err); }
  }

  if (!d) return <p className="muted">Loading…</p>;
  if (!d.ok) return <Notice kind="warn">The disclosure checklist appears once the statements can be produced.</Notice>;
  return (
    <section className="sheet stack">
      <h2>Disclosure checklist</h2>
      <p className="muted">Wording is draft, paraphrased from the standard, and needs your content owner’s review. Items with a note need written text.</p>
      <ErrorNote error={error} />
      <ul className="item-list">
        {d.disclosures?.map((x) => (
          <li key={x.id}>
            <div className="row between"><span>{x.text} <span className="muted small">({x.ref})</span></span><span className={`state ${x.satisfied ? 'manager_reviewed' : 'open'}`}>{x.satisfied ? 'Done' : 'To do'}</span></div>
            {!x.satisfied && x.noteId && !viewer.engagementLocked && (
              <div className="stack" style={{ marginTop: '0.5rem' }}>
                <textarea aria-label={`Note text for ${x.text}`} value={text[x.noteId] ?? ''} onChange={(ev) => setText({ ...text, [x.noteId!]: ev.target.value })} />
                <div><button className="secondary" disabled={(text[x.noteId] ?? '').trim().length === 0} onClick={() => save(x.noteId!, x.text)}>Save note</button></div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Export({ e }: { e: Engagement }) {
  const withStepUp = useStepUp();
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState('');

  async function run(format: 'docx' | 'xlsx' | 'pdf') {
    setError(undefined);
    setInfo('');
    setBusy(format);
    try {
      const { blob, filename } = await withStepUp(() => api.download(`/engagements/${e.id}/export`, { format }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setInfo(`Exported ${filename}. The export is recorded in the activity history.`);
    } catch (err) {
      if (!(err instanceof Error && err.message === 'cancelled')) setError(err);
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="sheet stack">
      <h2>Export</h2>
      <p className="muted">Exports carry your name and the time. Until the partner approves the engagement they are marked DRAFT. You confirm with a 6-digit code from your phone first.</p>
      <div className="row">
        <button disabled={!!busy} onClick={() => run('docx')}>Word document</button>
        <button disabled={!!busy} className="secondary" onClick={() => run('xlsx')}>Excel workbook</button>
        <button disabled={!!busy} className="secondary" onClick={() => run('pdf')}>PDF</button>
      </div>
      <ErrorNote error={error} />
      {info && <Notice>{info}</Notice>}
    </section>
  );
}

export function Financials({ engagement: e, viewer }: { engagement: Engagement; viewer: Viewer; onChanged: () => void }) {
  const [section, setSection] = useState<Section>('tb');
  const carry = useRef(false);
  const [carryInfo, setCarryInfo] = useState('');
  const [error, setError] = useState<unknown>();

  async function carryForward() {
    setError(undefined);
    carry.current = true;
    try {
      const r = await api.post<{ carriedMapping: boolean; carriedPriorYear: boolean }>(`/engagements/${e.id}/financials/carry-forward`, {});
      setCarryInfo(r.carriedMapping || r.carriedPriorYear
        ? `Carried forward${r.carriedMapping ? ' the account mapping' : ''}${r.carriedMapping && r.carriedPriorYear ? ' and' : ''}${r.carriedPriorYear ? ' last year’s figures as comparatives' : ''}.`
        : 'There is no earlier engagement for this client to carry forward from.');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <div className="tabs" role="tablist" aria-label="Financial statements steps" style={{ marginBottom: 0, flex: 1 }}>
          {SECTIONS.map((s) => <button key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>{s.label}</button>)}
        </div>
        {!viewer.engagementLocked && <button className="secondary" onClick={carryForward}>Carry forward from last year</button>}
      </div>
      <ErrorNote error={error} />
      {carryInfo && <Notice>{carryInfo}</Notice>}
      {section === 'tb' && <TrialBalance e={e} viewer={viewer} />}
      {section === 'mapping' && <Mapping e={e} viewer={viewer} />}
      {section === 'adjustments' && <Adjustments e={e} viewer={viewer} />}
      {section === 'statements' && <Statements e={e} />}
      {section === 'notes' && <Notes e={e} viewer={viewer} />}
      {section === 'export' && <Export e={e} />}
    </div>
  );
}
