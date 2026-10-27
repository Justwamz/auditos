'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { statusLabel } from '@/components/billing';
import { kes, todayNairobi } from '@/lib/dates';
import { saveBlob } from '@/lib/download';

interface Invoice {
  id: string; number: string | null; status: string; overdue: boolean; clientName: string; issueDate: string | null; dueDate: string | null; notes: string | null; taxMode: string;
  taxes: { name: string; rate: string; onPrevious: boolean; amount: string }[]; subtotal: string; taxTotal: string; total: string; paid: string; outstanding: string; voidReason: string | null;
  tax: { provider: string; simulated: boolean; status: string; controlNumber: string | null; message: string } | null;
  lines: { description: string; quantity: string; unitPrice: string; amount: string; source: string }[];
  payments: { amount: string; paidOn: string; method: string; reference: string | null }[];
}
const METHODS = [['bank', 'Bank transfer'], ['mpesa', 'M-Pesa'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['other', 'Other']] as const;

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const inv = useApi<Invoice>(`/invoices/${id}`);
  const me = useApi<{ role: string; isAdmin: boolean }>('/me');
  const manage = me.data?.role === 'partner' || me.data?.role === 'firm_admin' || me.data?.isAdmin;
  const [pay, setPay] = useState({ amount: '', paidOn: todayNairobi(), method: 'bank', reference: '' });
  const [voidReason, setVoidReason] = useState('');
  const [mail, setMail] = useState({ to: '', message: '' });
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');

  async function run(fn: () => Promise<unknown>, message = '') {
    setError(undefined);
    setInfo('');
    try {
      await fn();
      if (message) setInfo(message);
      inv.reload();
    } catch (e) {
      setError(e);
    }
  }

  if (inv.error) return <ErrorNote error={inv.error} />;
  if (!inv.data) return <p className="muted">Loading invoice…</p>;
  const i = inv.data;
  const issued = i.status !== 'draft';

  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="small"><Link href="/invoices">Invoices</Link></p>
        <div className="row between"><h1>{i.number ? `Invoice ${i.number}` : 'Draft invoice'}</h1><HelpLink topic="invoices" /></div>
        <p>{i.clientName} · {statusLabel(i.status, i.overdue)}{i.issueDate ? ` · issued ${i.issueDate}` : ''}{i.dueDate ? ` · due ${i.dueDate}` : ''}</p>
      </div>
      <ErrorNote error={error} />
      {info && <Notice>{info}</Notice>}

      {i.tax?.simulated && (
        <div className="sim-warning" role="alert">
          SIMULATION: this invoice has not been submitted to KRA and is not a valid tax invoice. Control number {i.tax.controlNumber} is made up. {i.tax.message}
        </div>
      )}
      {i.tax && !i.tax.simulated && i.tax.status !== 'submitted' && (
        <div className="notice warn" role="alert">{i.tax.message} {manage && <button className="secondary" onClick={() => run(() => api.post(`/invoices/${i.id}/submit`, {}), 'Submitted again.')}>Submit again</button>}</div>
      )}
      {i.status === 'void' && <div className="notice error">This invoice was voided: {i.voidReason}</div>}

      <section className="sheet stack">
        <table className="lines">
          <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {i.lines.map((l, n) => <tr key={n}><td>{l.description}</td><td className="num">{Number(l.quantity).toFixed(2)}</td><td className="num">{kes(l.unitPrice)}</td><td className="num">{kes(l.amount)}</td></tr>)}
          </tbody>
          <tfoot>
            <tr><td colSpan={3} className="num">{i.taxMode === 'inclusive' && i.taxes.length > 0 ? 'Amount before tax' : 'Subtotal'}</td><td className="num">{kes(i.subtotal)}</td></tr>
            {i.taxes.map((t) => <tr key={t.name}><td colSpan={3} className="num">{t.name} {t.rate}%{i.taxMode === 'inclusive' ? ' (included in the prices)' : ''}{t.onPrevious ? ', on top of the tax before it' : ''}</td><td className="num">{kes(t.amount)}</td></tr>)}
            {i.taxes.length === 0 && <tr><td colSpan={3} className="num">Tax</td><td className="num">None charged</td></tr>}
            <tr><td colSpan={3} className="num"><strong>Total</strong></td><td className="num"><strong>{kes(i.total)}</strong></td></tr>
            {issued && i.status !== 'void' && <tr><td colSpan={3} className="num">Paid</td><td className="num">{kes(i.paid)}</td></tr>}
            {issued && i.status !== 'void' && <tr><td colSpan={3} className="num"><strong>Balance due</strong></td><td className="num"><strong>{kes(i.outstanding)}</strong></td></tr>}
          </tfoot>
        </table>
        {i.notes && <p className="muted">{i.notes}</p>}
        <div className="row">
          <button className="secondary" onClick={() => run(async () => { const f = await api.downloadGet(`/invoices/${i.id}/pdf`); saveBlob(f.blob, f.filename); })}>Download PDF</button>
          {i.status === 'draft' && <Link href={`/invoices/new?edit=${i.id}`} className="button secondary">Change the draft</Link>}
          {i.status === 'draft' && <button className="danger" onClick={() => run(async () => { await api.del(`/invoices/${i.id}`); router.push('/invoices'); })}>Discard the draft</button>}
          {i.status === 'draft' && manage && <button onClick={() => run(() => api.post(`/invoices/${i.id}/issue`, {}), 'Issued. The invoice now has its number and can no longer be changed.')}>Issue the invoice</button>}
          {i.status === 'draft' && !manage && <span className="muted small">A partner or administrator issues invoices.</span>}
        </div>
      </section>

      {issued && i.status !== 'void' && (
        <form className="sheet stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.post(`/invoices/${i.id}/send`, { to: mail.to, ...(mail.message.trim() ? { message: mail.message } : {}) }), 'Kept in the outbox. Email is simulated, so nothing was actually sent.'); }}>
          <h2>Send to the client</h2>
          <div className="row">
            <input aria-label="Send to email address" type="email" required placeholder="client@example.com" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} />
            <input aria-label="Message" placeholder="Message (optional)" value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} style={{ minWidth: '18rem' }} />
            <button className="secondary">Send</button>
          </div>
          <p className="muted small">Email is not connected yet: the message is kept in the <Link href="/billing/outbox">outbox</Link> and not delivered.</p>
        </form>
      )}

      {issued && (
        <section className="sheet stack">
          <h2>Payments</h2>
          {i.payments.length === 0 && <p className="muted">No payments recorded.</p>}
          {i.payments.length > 0 && (
            <table>
              <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
              <tbody>{i.payments.map((p, n) => <tr key={n}><td>{p.paidOn}</td><td>{kes(p.amount)}</td><td>{p.method}</td><td>{p.reference}</td></tr>)}</tbody>
            </table>
          )}
          {manage && (i.status === 'sent' || i.status === 'part_paid') && (
            <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.post(`/invoices/${i.id}/payments`, { amount: pay.amount, paidOn: pay.paidOn, method: pay.method, ...(pay.reference.trim() ? { reference: pay.reference } : {}) }), 'Payment recorded.'); }}>
              <input aria-label="Amount received (KES)" required inputMode="decimal" placeholder="Amount (KES)" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} style={{ width: '9rem' }} />
              <input aria-label="Date received" type="date" required value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
              <select aria-label="Method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input aria-label="Reference" placeholder="Reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
              <button className="secondary">Record payment</button>
            </form>
          )}
        </section>
      )}

      {manage && i.status === 'sent' && (
        <form className="sheet stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.post(`/invoices/${i.id}/void`, { reason: voidReason }), 'Voided. The time and expenses it billed can be invoiced again.'); }}>
          <h2>Void this invoice</h2>
          <p className="muted">An issued invoice cannot be changed. If it is wrong, void it with a reason and issue a new one. An invoice that has had a payment cannot be voided.</p>
          <div className="row">
            <input aria-label="Reason for voiding" required minLength={5} placeholder="Why? (recorded)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} style={{ minWidth: '20rem' }} />
            <button className="danger">Void invoice</button>
          </div>
        </form>
      )}
    </div>
  );
}
