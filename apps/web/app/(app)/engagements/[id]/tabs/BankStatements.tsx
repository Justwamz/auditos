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

interface Integrity { status: 'verified' | 'broken' | 'unverified'; messages: string[]; computedClosing?: string | null; difference?: string | null; balanceBreaks?: { index: number; date: string; description: string; expected: string; printed: string }[] }
interface Summary {
  id: string; filename: string; source: string; bankName: string | null; accountLast4: string | null; periodFrom: string | null; periodTo: string | null;
  opening: string | null; closing: string | null; transactionCount: number; integrity: Integrity; confirmed: boolean; confirmedBy: string | null; acknowledgedReason: string | null; uploadedBy: string;
}
interface Preview extends Omit<Summary, 'filename' | 'confirmed' | 'confirmedBy' | 'acknowledgedReason' | 'uploadedBy'> {
  totals: { in: string; out: string }; unreadable: { message: string; line: string | null }[]; preview: { date: string; description: string; amount: string; balance: string | null }[];
}
interface Entries { transactions: { index: number; date: string; description: string; amount: string; balance: string | null }[]; offset: number; transactionCount: number }
interface Row { index: number; date: string; description: string; amount: string }
interface Analysis {
  monthly: { month: string; count: number; in: string; out: string; closing: string | null }[];
  largestIn: Row[]; largestOut: Row[];
  cash: { in: string; out: string; count: number }; mobileMoney: { in: string; out: string; count: number };
  flags: { code: string; severity: string; message: string; feeds: string; rows: Row[]; rowCount: number }[];
  reconciliation: { statementClosing: string | null; ledger: string; difference: string | null; status: string } | null;
}

const STATUS_TEXT: Record<Integrity['status'], string> = { verified: 'Adds up', broken: 'Does not add up', unverified: 'Could not be checked' };
const FEEDS: Record<string, string> = {
  'going-concern': 'Going concern checklist', 'journals-trial-balance': 'Journals and trial balance checklist',
  'related-parties': 'Related parties checklist', 'laws-regulations': 'Laws and regulations checklist',
};

function Status({ s }: { s: Integrity['status'] }) {
  return <span className={`state ${s === 'verified' ? 'partner_approved' : s === 'broken' ? 'draft' : 'prepared'}`}>{STATUS_TEXT[s]}</span>;
}

/** Bank statements: read from the client's file, checked for completeness, confirmed by a person, then analysed. */
export function BankStatements({ engagement: e, viewer }: { engagement: Engagement; viewer: Viewer }) {
  const list = useApi<{ statements: Summary[] }>(`/engagements/${e.id}/bank-statements`);
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<unknown>();
  const [needPassword, setNeedPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);
  const [openId, setOpenId] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const readOnly = viewer.engagementLocked;

  async function upload(ev: FormEvent) {
    ev.preventDefault();
    const f = file.current?.files?.[0];
    if (!f) return;
    setError(undefined);
    setPreview(undefined);
    setBusy(true);
    const fd = new FormData();
    // Fields go before the file so the server has the password when it opens the file.
    if (password.current?.value) fd.append('password', password.current.value);
    fd.append('file', f);
    try {
      const r = await api.upload<Preview>(`/engagements/${e.id}/bank-statements`, fd);
      setPreview(r);
      setNeedPassword(false);
      setPanel(false);
      if (file.current) file.current.value = '';
      if (password.current) password.current.value = '';
      list.reload();
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'password_required' || err.code === 'password_incorrect')) setNeedPassword(true);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <SectionHead
        title="Bank statements"
        sentence="Read from the client's file, checked for completeness, confirmed by a person, then analysed."
        help={<HelpLink topic="engagement.bank-statements" label="How it works" />}
        action={!readOnly ? <button type="button" className={preview ? 'secondary' : undefined} onClick={() => { setError(undefined); setPanel(true); }}>+ Upload a statement</button> : undefined}
      />
      {!readOnly && (
        <SidePanel
          open={panel}
          title="Upload a bank statement"
          onClose={() => { setPanel(false); setError(undefined); }}
          footer={
            <>
              <button type="button" className="quiet" onClick={() => { setPanel(false); setError(undefined); }}>Cancel</button>
              <button type="submit" form="bank-upload-form" disabled={busy}>{busy ? 'Reading…' : 'Read statement'}</button>
            </>
          }
        >
          <form id="bank-upload-form" className="stack" onSubmit={upload}>
            <p className="muted">
              A PDF with text in it, a CSV or an Excel file. Scanned PDFs (pictures of paper) cannot be read: ask the client for the original download.
              The entries are read and checked to add up before anything is analysed.
            </p>
            <div className="field"><label htmlFor="bsf">Statement file</label><input id="bsf" type="file" ref={file} required accept=".pdf,.csv,.xlsx" /></div>
            <div className="field">
              <label htmlFor="bsp">{needPassword ? 'Password for this PDF (required)' : 'PDF password, if it has one'}</label>
              <input id="bsp" type="password" ref={password} autoComplete="off" />
              <span className="muted small">Used once to open the file. It is never saved.</span>
            </div>
            <ErrorNote error={error} />
          </form>
        </SidePanel>
      )}

      {preview && <PreviewCard e={e} p={preview} onDone={() => { setPreview(undefined); list.reload(); }} readOnly={readOnly} />}

      <section className="sheet stack">
        <h2>Statements on this engagement</h2>
        {list.error ? <ErrorNote error={list.error} /> : !list.data ? <p className="muted">Loading…</p> : list.data.statements.length === 0 ? (
          <Empty>No statements yet. Use Upload a statement at the top to add one.</Empty>
        ) : (
          <table>
            <thead><tr><th>Statement</th><th>Period</th><th className="num">Entries</th><th className="num">Closing (KES)</th><th>Check</th><th>Confirmed</th><th /></tr></thead>
            <tbody>
              {list.data.statements.map((s) => (
                <tr key={s.id}>
                  <td>{s.filename}<br /><span className="muted">{[s.bankName, s.accountLast4 ? `account ending ${s.accountLast4}` : null].filter(Boolean).join(' · ') || s.source.toUpperCase()}</span></td>
                  <td>{s.periodFrom ? `${fmtDate(s.periodFrom)} – ${fmtDate(s.periodTo)}` : ''}</td>
                  <td className="num">{s.transactionCount}</td>
                  <td className="num">{kes(s.closing)}</td>
                  <td><Status s={s.integrity.status} /></td>
                  <td>{s.confirmed ? `Yes, ${s.confirmedBy ?? ''}` : 'Not yet'}{s.acknowledgedReason ? <><br /><span className="muted">Reason: {s.acknowledgedReason}</span></> : null}</td>
                  <td><button className="secondary" onClick={() => setOpenId(openId === s.id ? undefined : s.id)}>{openId === s.id ? 'Close' : 'Open'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {openId && list.data && <StatementDetail key={openId} e={e} s={list.data.statements.find((x) => x.id === openId)!} readOnly={readOnly} onChanged={list.reload} />}
    </div>
  );
}

function PreviewCard({ e, p, onDone, readOnly }: { e: Engagement; p: Preview; onDone: () => void; readOnly: boolean }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>();
  const ok = p.integrity.status === 'verified';

  async function confirm() {
    setError(undefined);
    try {
      await api.post(`/engagements/${e.id}/bank-statements/${p.id}/confirm`, ok ? {} : { reason });
      onDone();
    } catch (err) { setError(err); }
  }
  async function discard() {
    setError(undefined);
    try { await api.del(`/engagements/${e.id}/bank-statements/${p.id}`); onDone(); } catch (err) { setError(err); }
  }

  return (
    <section className="sheet stack" aria-label="Statement just read">
      <div className="row between"><h2>Check what was read</h2><Status s={p.integrity.status} /></div>
      <p>
        {p.bankName ? `${p.bankName}, ` : ''}{p.accountLast4 ? `account ending ${p.accountLast4}, ` : ''}{p.transactionCount} entries
        {p.periodFrom ? `, ${fmtDate(p.periodFrom)} to ${fmtDate(p.periodTo)}` : ''}. Opening balance <strong>{kes(p.opening) || 'not found'}</strong>, closing balance <strong>{kes(p.closing) || 'not found'}</strong>.
        Money in {kes(p.totals.in)}, money out {kes(p.totals.out)}.
      </p>
      {p.integrity.messages.map((m) => <Notice key={m} kind={ok ? 'ok' : 'warn'}>{m}</Notice>)}
      {ok && <Notice>Every entry was read and the balances agree.</Notice>}
      {(p.integrity.balanceBreaks?.length ?? 0) > 0 && (
        <table>
          <caption>Where the running balance stops following</caption>
          <thead><tr><th>Date</th><th>Entry</th><th className="num">Should be</th><th className="num">Statement says</th></tr></thead>
          <tbody>{p.integrity.balanceBreaks!.slice(0, 5).map((b) => <tr key={b.index}><td>{fmtDate(b.date)}</td><td>{b.description}</td><td className="num">{kes(b.expected)}</td><td className="num">{kes(b.printed)}</td></tr>)}</tbody>
        </table>
      )}
      {p.unreadable.length > 0 && <div className="notice warn"><p>Rows that could not be read:</p><ul>{p.unreadable.slice(0, 10).map((u, i) => <li key={i}>{u.message}{u.line ? `: ${u.line}` : ''}</li>)}</ul></div>}
      <table>
        <caption>The first entries, to compare with the file</caption>
        <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
        <tbody>{p.preview.map((t, i) => <tr key={i}><td>{fmtDate(t.date)}</td><td>{t.description}</td><td className="num">{kes(t.amount)}</td><td className="num">{kes(t.balance)}</td></tr>)}</tbody>
      </table>
      <ErrorNote error={error} />
      {!readOnly && (
        <>
          {!ok && (
            <div className="field">
              <label htmlFor="bsr">To confirm anyway, say why (kept on the record)</label>
              <textarea id="bsr" rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} />
            </div>
          )}
          <div className="row">
            <button onClick={confirm} disabled={!ok && reason.trim().length < 5}>{ok ? 'Confirm: read completely' : 'Confirm with reason'}</button>
            <button className="secondary" onClick={discard}>Discard and upload again</button>
          </div>
        </>
      )}
    </section>
  );
}

function StatementDetail({ e, s, readOnly, onChanged }: { e: Engagement; s: Summary; readOnly: boolean; onChanged: () => void }) {
  const [offset, setOffset] = useState(0);
  const entries = useApi<Entries>(`/engagements/${e.id}/bank-statements/${s.id}?offset=${offset}&limit=50`);
  const [ledger, setLedger] = useState('');
  const [parties, setParties] = useState('');
  const [analysis, setAnalysis] = useState<Analysis>();
  const [error, setError] = useState<unknown>();
  const [reason, setReason] = useState('');

  async function run(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    const q = new URLSearchParams();
    if (ledger.trim()) q.set('ledger', ledger.trim());
    if (parties.trim()) q.set('parties', parties.trim());
    try { setAnalysis(await api.get<Analysis>(`/engagements/${e.id}/bank-statements/${s.id}/analysis?${q}`)); } catch (err) { setError(err); }
  }
  async function confirm() {
    setError(undefined);
    try { await api.post(`/engagements/${e.id}/bank-statements/${s.id}/confirm`, s.integrity.status === 'verified' ? {} : { reason }); onChanged(); } catch (err) { setError(err); }
  }

  return (
    <section className="sheet stack" aria-label={`Statement ${s.filename}`}>
      <h2>{s.filename}</h2>
      {!s.confirmed && !readOnly && (
        <div className="stack">
          <Notice kind="warn">This statement has not been confirmed. Confirm it once you have checked it was read completely; analysis only runs on a confirmed statement.</Notice>
          {s.integrity.status !== 'verified' && <div className="field"><label htmlFor="bsr2">Reason for confirming a statement that does not fully add up</label><textarea id="bsr2" rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} /></div>}
          <div><button onClick={confirm} disabled={s.integrity.status !== 'verified' && reason.trim().length < 5}>Confirm</button></div>
        </div>
      )}
      <ErrorNote error={error} />

      {s.confirmed && (
        <form className="stack" onSubmit={run}>
          <h3>Analysis</h3>
          <div className="form-grid">
            <div className="field"><label htmlFor="bsl">Bank balance in the books (KES), to reconcile to</label><input id="bsl" inputMode="decimal" value={ledger} onChange={(ev) => setLedger(ev.target.value)} /></div>
            <div className="field"><label htmlFor="bsn">Related party names, separated by commas</label><input id="bsn" value={parties} onChange={(ev) => setParties(ev.target.value)} /></div>
          </div>
          <div><button className="secondary">Analyse</button></div>
        </form>
      )}
      {analysis && <AnalysisView a={analysis} />}

      <h3>Entries</h3>
      {!entries.data ? <p className="muted">Loading…</p> : (
        <>
          <table>
            <thead><tr><th>#</th><th>Date</th><th>Description</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
            <tbody>{entries.data.transactions.map((t) => <tr key={t.index}><td>{t.index + 1}</td><td>{fmtDate(t.date)}</td><td>{t.description}</td><td className="num">{kes(t.amount)}</td><td className="num">{kes(t.balance)}</td></tr>)}</tbody>
          </table>
          <div className="row">
            <button className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous 50</button>
            <button className="secondary" disabled={offset + 50 >= s.transactionCount} onClick={() => setOffset(offset + 50)}>Next 50</button>
            <span className="muted">Entries {offset + 1} to {Math.min(offset + 50, s.transactionCount)} of {s.transactionCount}</span>
          </div>
        </>
      )}
    </section>
  );
}

function AnalysisView({ a }: { a: Analysis }) {
  return (
    <div className="stack" aria-label="Analysis results">
      <table>
        <caption>By month</caption>
        <thead><tr><th>Month</th><th className="num">Entries</th><th className="num">Money in</th><th className="num">Money out</th><th className="num">Month-end balance</th></tr></thead>
        <tbody>{a.monthly.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{m.count}</td><td className="num">{kes(m.in)}</td><td className="num">{kes(m.out)}</td><td className="num">{kes(m.closing)}</td></tr>)}</tbody>
      </table>
      <p>Cash: in {kes(a.cash.in)}, out {kes(a.cash.out)} ({a.cash.count} entries). Mobile money: in {kes(a.mobileMoney.in)}, out {kes(a.mobileMoney.out)} ({a.mobileMoney.count} entries).</p>
      {a.reconciliation && (
        <Notice kind={a.reconciliation.status === 'matched' ? 'ok' : 'warn'}>
          {a.reconciliation.status === 'matched'
            ? `The statement closes at ${kes(a.reconciliation.statementClosing)}, the same as the books.`
            : `The statement closes at ${kes(a.reconciliation.statementClosing)} and the books show ${kes(a.reconciliation.ledger)}: a difference of ${kes(a.reconciliation.difference)} to explain with reconciling items.`}
        </Notice>
      )}
      <h4>Things to look at</h4>
      {a.flags.length === 0 ? <Empty>Nothing stood out under these rules. That is not a conclusion: the rules only look for common patterns.</Empty> : (
        <ul className="stack">
          {a.flags.map((f) => (
            <li key={f.code}>
              <p><strong>{f.message}</strong></p>
              <p className="muted">Goes with: {FEEDS[f.feeds] ?? f.feeds}</p>
              {f.rows.length > 0 && (
                <table>
                  <tbody>{f.rows.map((r) => <tr key={r.index}><td>#{r.index + 1}</td><td>{fmtDate(r.date)}</td><td>{r.description}</td><td className="num">{kes(r.amount)}</td></tr>)}</tbody>
                </table>
              )}
              {f.rowCount > f.rows.length && <p className="muted">…and {f.rowCount - f.rows.length} more.</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="grid-2">
        <table><caption>Largest money in</caption><tbody>{a.largestIn.map((r) => <tr key={r.index}><td>{fmtDate(r.date)}</td><td>{r.description}</td><td className="num">{kes(r.amount)}</td></tr>)}</tbody></table>
        <table><caption>Largest money out</caption><tbody>{a.largestOut.map((r) => <tr key={r.index}><td>{fmtDate(r.date)}</td><td>{r.description}</td><td className="num">{kes(r.amount)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
