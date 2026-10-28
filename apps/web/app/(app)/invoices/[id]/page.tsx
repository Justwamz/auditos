'use client';
import Link from 'next/link';
import { BillingTabs } from '@/components/BillingTabs';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { statusLabel } from '@/components/billing';
import { PageHead } from '@/components/ui/PageHead';
import { RowMenu } from '@/components/ui/RowMenu';
import { SidePanel } from '@/components/ui/SidePanel';
import { Skeleton } from '@/components/ui/EmptyState';
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
const METHOD_LABEL: Record<string, string> = Object.fromEntries(METHODS);
type Panel = 'pay' | 'send' | 'void' | null;
const PAY_FORM = 'invoice-pay-form';
const SEND_FORM = 'invoice-send-form';
const VOID_FORM = 'invoice-void-form';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const inv = useApi<Invoice>(`/invoices/${id}`);
  const me = useApi<{ role: string; isAdmin: boolean }>('/me');
  const manage = me.data?.role === 'partner' || me.data?.role === 'firm_admin' || me.data?.isAdmin;
  const [pay, setPay] = useState({ amount: '', paidOn: todayNairobi(), method: 'bank', reference: '' });
  const [voidReason, setVoidReason] = useState('');
  const [mail, setMail] = useState({ to: '', message: '' });
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');

  /** Runs one action. Returns whether it worked; a failure is kept in `error` (shown in the open panel, or on the page). */
  async function run(fn: () => Promise<unknown>, message = ''): Promise<boolean> {
    setError(undefined);
    setInfo('');
    setBusy(true);
    try {
      await fn();
      if (message) setInfo(message);
      inv.reload();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const openPanel = (p: Panel) => { setError(undefined); setInfo(''); setPanel(p); };
  const closePanel = () => { setPanel(null); setError(undefined); };
  const submitIn = (fn: () => Promise<unknown>, message: string, after?: () => void) => async (e: FormEvent) => {
    e.preventDefault();
    if (await run(fn, message)) {
      setPanel(null);
      after?.();
    }
  };

  if (inv.error) return <ErrorNote error={inv.error} />;
  if (!inv.data) {
    return (
      <section className="sheet prospects-loading" aria-label="Loading invoice">
        <Skeleton height={36} width="40%" />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </section>
    );
  }
  const i = inv.data;
  const issued = i.status !== 'draft';
  const canPay = !!manage && (i.status === 'sent' || i.status === 'part_paid');
  const canVoid = !!manage && i.status === 'sent';
  const canIssue = i.status === 'draft' && !!manage;

  const main = canIssue
    ? <button type="button" disabled={busy} onClick={() => run(() => api.post(`/invoices/${i.id}/issue`, {}), 'Issued. The invoice now has its number and can no longer be changed.')}>Issue the invoice</button>
    : canPay
      ? <button type="button" onClick={() => openPanel('pay')}>Record payment</button>
      : undefined;

  return (
    <div className="stack-lg">
      <p className="small"><Link href="/invoices">Invoices</Link></p>
      <PageHead
        title={i.number ? `Invoice ${i.number}` : 'Draft invoice'}
        sentence={`${i.clientName} · ${statusLabel(i.status, i.overdue)}${i.issueDate ? ` · issued ${i.issueDate}` : ''}${i.dueDate ? ` · due ${i.dueDate}` : ''}`}
        action={main}
        help={<HelpLink topic="invoices" />}
      />
      <BillingTabs />
      {!panel && <ErrorNote error={error} />}
      {info && <Notice>{info}</Notice>}

      {i.tax?.simulated && (
        <div className="sim-warning" role="alert">
          PRACTICE ONLY: this invoice has not been sent to KRA and is not a valid tax invoice. {i.tax.controlNumber ? `The control number ${i.tax.controlNumber} is made up.` : ''}
        </div>
      )}
      {i.tax && !i.tax.simulated && i.tax.status !== 'submitted' && (
        <div className="notice warn" role="alert">{i.tax.message} {manage && <button type="button" className="secondary" onClick={() => run(() => api.post(`/invoices/${i.id}/submit`, {}), 'Submitted again.')}>Submit again</button>}</div>
      )}
      {i.status === 'void' && <div className="notice error">This invoice was voided: {i.voidReason}</div>}

      <section className="sheet stack">
        <table className="lines" aria-label="Invoice lines">
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
        <div className="doc-actions">
          <button type="button" className="secondary" onClick={() => run(async () => { const f = await api.downloadGet(`/invoices/${i.id}/pdf`); saveBlob(f.blob, f.filename); })}>Download PDF</button>
          {i.status === 'draft' && <Link href={`/invoices/new?edit=${i.id}`} className="button secondary">Change the draft</Link>}
          {issued && i.status !== 'void' && <button type="button" className="secondary" onClick={() => openPanel('send')}>Send to the client</button>}
          {i.status === 'draft' && !manage && <span className="muted small">A partner or administrator issues invoices.</span>}
          <RowMenu
            label="More actions for this invoice"
            items={[
              { label: 'Discard the draft', danger: true, hidden: i.status !== 'draft', onSelect: () => { void run(async () => { await api.del(`/invoices/${i.id}`); router.push('/invoices'); }); } },
              { label: 'Void this invoice', danger: true, hidden: !canVoid, onSelect: () => openPanel('void') },
            ]}
          />
        </div>
      </section>

      {issued && (
        <section className="sheet stack">
          <h2>Payments</h2>
          {i.payments.length === 0 && <p className="muted">No payments recorded.</p>}
          {i.payments.length > 0 && (
            <div className="prospects-scroll">
              <table className="prospects-table" aria-label="Payments">
                <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th>Reference</th></tr></thead>
                <tbody>{i.payments.map((p, n) => <tr key={n}><td>{p.paidOn}</td><td className="num">{kes(p.amount)}</td><td>{METHOD_LABEL[p.method] ?? p.method}</td><td>{p.reference}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canPay && (
        <SidePanel
          open={panel === 'pay'}
          title="Record a payment"
          onClose={closePanel}
          footer={<><button type="button" className="quiet" onClick={closePanel}>Cancel</button><button type="submit" form={PAY_FORM} disabled={busy}>Record payment</button></>}
        >
          <form id={PAY_FORM} className="stack" onSubmit={submitIn(() => api.post(`/invoices/${i.id}/payments`, { amount: pay.amount, paidOn: pay.paidOn, method: pay.method, ...(pay.reference.trim() ? { reference: pay.reference } : {}) }), 'Payment recorded.', () => setPay({ amount: '', paidOn: todayNairobi(), method: 'bank', reference: '' }))}>
            <ErrorNote error={error} />
            <div className="field"><label htmlFor="pa">Amount received (KES)</label><input id="pa" required inputMode="decimal" placeholder="0.00" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
            <div className="field"><label htmlFor="pd">Date received</label><input id="pd" type="date" required value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="pm">Method</label>
              <select id="pm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="pr">Reference</label><input id="pr" placeholder="For example the bank or M-Pesa reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
          </form>
        </SidePanel>
      )}

      {issued && i.status !== 'void' && (
        <SidePanel
          open={panel === 'send'}
          title="Send to the client"
          onClose={closePanel}
          footer={<><button type="button" className="quiet" onClick={closePanel}>Cancel</button><button type="submit" form={SEND_FORM} disabled={busy}>Send</button></>}
        >
          <form id={SEND_FORM} className="stack" onSubmit={submitIn(() => api.post(`/invoices/${i.id}/send`, { to: mail.to, ...(mail.message.trim() ? { message: mail.message } : {}) }), 'Kept in the sent emails list. Nothing was actually sent (practice mode).')}>
            <ErrorNote error={error} />
            <div className="field"><label htmlFor="se">Send to email address</label><input id="se" type="email" required placeholder="client@example.com" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} /></div>
            <div className="field"><label htmlFor="sm">Message (optional)</label><input id="sm" value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} /></div>
            <p className="muted small">Email is not connected yet, so nothing is actually sent (practice mode). The message is kept under <Link href="/billing/outbox">Sent emails</Link> so you can see it.</p>
          </form>
        </SidePanel>
      )}

      {canVoid && (
        <SidePanel
          open={panel === 'void'}
          title="Void this invoice"
          onClose={closePanel}
          footer={<><button type="button" className="quiet" onClick={closePanel}>Cancel</button><button type="submit" form={VOID_FORM} className="danger" disabled={busy}>Void invoice</button></>}
        >
          <form id={VOID_FORM} className="stack" onSubmit={submitIn(() => api.post(`/invoices/${i.id}/void`, { reason: voidReason }), 'Voided. The time and expenses it billed can be invoiced again.')}>
            <ErrorNote error={error} />
            <p className="muted">An issued invoice cannot be changed. If it is wrong, void it with a reason and issue a new one. An invoice that has had a payment cannot be voided.</p>
            <div className="field"><label htmlFor="vr">Reason for voiding</label><input id="vr" required minLength={5} placeholder="Why? (recorded)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} /></div>
          </form>
        </SidePanel>
      )}
    </div>
  );
}
