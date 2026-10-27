'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { blankLine, LinesEditor, TaxPicker, type LineInput } from '@/components/billing';
import { hoursLabel, kes } from '@/lib/dates';

interface Billable {
  client: { id: string; name: string };
  time: { id: string; userName: string; workDate: string; minutes: number; description: string; rate: string; value: string }[];
  expenses: { id: string; spentOn: string; category: string; description: string; amount: string }[];
  fee: { basis: string; flatFee: string | null } | null;
}

function Builder() {
  const router = useRouter();
  const editing = useSearchParams().get('edit');
  const clients = useApi<{ clients: { id: string; name: string }[] }>('/clients');
  const engagements = useApi<{ engagements: { id: string; clientId: string; clientName: string; periodEnd: string; member: boolean }[] }>('/engagements');
  const [clientId, setClientId] = useState('');
  const [engagementId, setEngagementId] = useState('');
  const billable = useApi<Billable>(engagementId ? `/engagements/${engagementId}/billable` : null);
  const existing = useApi<{ clientId: string; engagementId: string | null; notes: string | null; taxMode: 'exclusive' | 'inclusive'; lines: { description: string; quantity: string; unitPrice: string; source: string }[] }>(editing ? `/invoices/${editing}` : null);
  const [timeIds, setTimeIds] = useState<string[]>([]);
  const [expenseIds, setExpenseIds] = useState<string[]>([]);
  const [flatFee, setFlatFee] = useState(false);
  const [lines, setLines] = useState<LineInput[]>([blankLine()]);
  const [tax, setTax] = useState<{ taxIds: string[]; mode: 'exclusive' | 'inclusive' }>({ taxIds: [], mode: 'exclusive' });
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setClientId(d.clientId);
    setEngagementId(d.engagementId ?? '');
    setNotes(d.notes ?? '');
    setTax((t) => ({ ...t, mode: d.taxMode }));
    const manual = d.lines.filter((l) => l.source === 'manual').map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }));
    setLines(manual.length > 0 ? manual : [blankLine()]);
  }, [existing.data]);

  const forClient = engagements.data?.engagements.filter((e) => e.clientId === clientId) ?? [];
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    const manual = lines.filter((l) => l.description.trim() !== '' || l.unitPrice.trim() !== '');
    const body = {
      clientId, taxMode: tax.mode, taxIds: tax.taxIds, ...(notes.trim() ? { notes } : {}), lines: manual,
      ...(engagementId ? { engagementId, billing: { timeEntryIds: timeIds, expenseIds, flatFee } } : {}),
    };
    try {
      const id = editing ? (await api.put(`/invoices/${editing}`, body), editing) : (await api.post<{ id: string }>('/invoices', body)).id;
      router.push(`/invoices/${id}`);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="small"><Link href="/invoices">Invoices</Link></p>
        <div className="row between"><h1>{editing ? 'Change the draft invoice' : 'New invoice'}</h1><HelpLink topic="invoices" /></div>
        <p>Choose the client. To bill time, expenses or the fixed fee from an engagement, choose the engagement too. You can add lines of your own as well.</p>
      </div>
      <form className="stack-lg" onSubmit={save}>
        <section className="sheet stack">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ic">Client</label>
              <select id="ic" required value={clientId} disabled={!!editing} onChange={(e) => { setClientId(e.target.value); setEngagementId(''); setTimeIds([]); setExpenseIds([]); setFlatFee(false); }}>
                <option value="">Choose a client</option>
                {clients.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ie">Engagement (to bill time, expenses or the fixed fee)</label>
              <select id="ie" value={engagementId} disabled={!clientId} onChange={(e) => { setEngagementId(e.target.value); setTimeIds([]); setExpenseIds([]); setFlatFee(false); }}>
                <option value="">None: only the lines below</option>
                {forClient.map((g) => <option key={g.id} value={g.id}>Year ended {g.periodEnd}{g.member ? '' : ' (view only)'}</option>)}
              </select>
            </div>
          </div>
        </section>

        {engagementId && billable.data && (
          <section className="sheet stack">
            <h2>Not yet invoiced on this engagement</h2>
            {billable.data.fee?.basis === 'flat' && (
              <label className="row"><input type="checkbox" checked={flatFee} onChange={(e) => setFlatFee(e.target.checked)} /> Bill the fixed fee ({kes(billable.data.fee.flatFee)})</label>
            )}
            {billable.data.time.length === 0 && billable.data.expenses.length === 0 && !billable.data.fee && <p className="muted">Nothing unbilled here.</p>}
            {billable.data.time.length > 0 && (
              <table>
                <thead><tr><th /><th>Date</th><th>Person</th><th>Work</th><th>Time</th><th>Value</th></tr></thead>
                <tbody>
                  {billable.data.time.map((t) => (
                    <tr key={t.id}>
                      <td><input type="checkbox" aria-label={`Bill ${t.description}`} checked={timeIds.includes(t.id)} onChange={() => toggle(timeIds, setTimeIds, t.id)} /></td>
                      <td>{t.workDate}</td><td>{t.userName}</td><td>{t.description}</td><td>{hoursLabel(t.minutes)}</td><td>{kes(t.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {billable.data.expenses.length > 0 && (
              <table>
                <thead><tr><th /><th>Date</th><th>Expense</th><th>Amount</th></tr></thead>
                <tbody>
                  {billable.data.expenses.map((x) => (
                    <tr key={x.id}>
                      <td><input type="checkbox" aria-label={`Bill ${x.description}`} checked={expenseIds.includes(x.id)} onChange={() => toggle(expenseIds, setExpenseIds, x.id)} /></td>
                      <td>{x.spentOn}</td><td>{x.category}: {x.description}</td><td>{kes(x.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        <section className="sheet stack">
          <h2>Other lines</h2>
          <LinesEditor lines={lines} onChange={setLines} />
        </section>

        <section className="sheet stack">
          <TaxPicker taxIds={tax.taxIds} mode={tax.mode} onChange={setTax} />
          <div className="field"><label htmlFor="in">Notes on the invoice</label><textarea id="in" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </section>

        <ErrorNote error={error} />
        <div className="row"><button>Save as draft</button><span className="muted small">Totals and tax are worked out when you save.</span></div>
      </form>
    </div>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense>
      <Builder />
    </Suspense>
  );
}
