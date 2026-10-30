'use client';
import Link from 'next/link';
import { BillingTabs } from '@/components/BillingTabs';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { Letterhead, statusLabel, type LetterheadData } from '@/components/billing';
import { PageHead } from '@/components/ui/PageHead';
import { RowMenu } from '@/components/ui/RowMenu';
import { SidePanel } from '@/components/ui/SidePanel';
import { Skeleton } from '@/components/ui/EmptyState';
import { kes } from '@/lib/dates';
import { saveBlob } from '@/lib/download';
import { TableScroll } from '@/components/ui/TableScroll';

interface Quote {
  id: string; number: string | null; status: string; clientId: string | null; subjectName: string; title: string; validUntil: string | null; notes: string | null; taxMode: string;
  taxes: { name: string; rate: string; amount: string }[]; subtotal: string; taxTotal: string; total: string;
  letterhead: LetterheadData | null; letterheadIsLive: boolean;
  lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
}
type Panel = 'send' | 'fee' | null;
const SEND_FORM = 'quote-send-form';
const FEE_FORM = 'quote-fee-form';

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<Quote>(`/quotes/${id}`);
  const engagements = useApi<{ engagements: { id: string; clientId: string; clientName: string; periodEnd: string; member: boolean }[] }>('/engagements');
  const [to, setTo] = useState('');
  const [engagementId, setEngagementId] = useState('');
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
      q.reload();
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
  const submitIn = (fn: () => Promise<unknown>, message: string) => async (e: FormEvent) => {
    e.preventDefault();
    if (await run(fn, message)) setPanel(null);
  };

  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) {
    return (
      <section className="sheet prospects-loading" aria-label="Loading quotation">
        <Skeleton height={36} width="40%" />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </section>
    );
  }
  const d = q.data;
  const mine = engagements.data?.engagements.filter((e) => e.member && e.clientId === d.clientId) ?? [];
  const canFee = d.status === 'accepted' && !!d.clientId;

  const main = d.status === 'draft'
    ? <button type="button" onClick={() => openPanel('send')}>Send and number it</button>
    : d.status === 'sent'
      ? <button type="button" disabled={busy} onClick={() => run(() => api.post(`/quotes/${d.id}/accept`, {}), 'Marked as accepted.')}>Mark as accepted</button>
      : canFee
        ? <button type="button" onClick={() => openPanel('fee')}>Set the fee</button>
        : undefined;

  return (
    <div className="stack-lg">
      <p className="small"><Link href="/quotes">Quotations</Link></p>
      <PageHead
        title={d.number ? `Quotation ${d.number}` : 'Draft quotation'}
        sentence={`${d.subjectName} · ${d.title} · ${statusLabel(d.status)}${d.validUntil ? ` · valid until ${d.validUntil}` : ''}`}
        action={main}
        help={<HelpLink topic="quotes" />}
      />
      <BillingTabs />
      {!panel && <ErrorNote error={error} />}
      {info && <Notice>{info}</Notice>}

      <section className="sheet stack">
        <Letterhead letterhead={d.letterhead} live={d.status !== 'draft' && d.letterheadIsLive} />
        <TableScroll label="Quotation lines list"><table className="lines" aria-label="Quotation lines">
          <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>{d.lines.map((l, n) => <tr key={n}><td>{l.description}</td><td className="num">{Number(l.quantity).toFixed(2)}</td><td className="num">{kes(l.unitPrice)}</td><td className="num">{kes(l.amount)}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={3} className="num">{d.taxMode === 'inclusive' && d.taxes.length > 0 ? 'Amount before tax' : 'Subtotal'}</td><td className="num">{kes(d.subtotal)}</td></tr>
            {d.taxes.map((t) => <tr key={t.name}><td colSpan={3} className="num">{t.name} {t.rate}%{d.taxMode === 'inclusive' ? ' (included)' : ''}</td><td className="num">{kes(t.amount)}</td></tr>)}
            <tr><td colSpan={3} className="num"><strong>Total</strong></td><td className="num"><strong>{kes(d.total)}</strong></td></tr>
          </tfoot>
        </table></TableScroll>
        {d.notes && <p className="muted">{d.notes}</p>}
        <div className="doc-actions">
          <button type="button" className="secondary" onClick={() => run(async () => { const f = await api.downloadGet(`/quotes/${d.id}/pdf`); saveBlob(f.blob, f.filename); })}>Download PDF</button>
          <RowMenu
            label="More actions for this quotation"
            items={[{ label: 'Mark as declined', danger: true, hidden: d.status !== 'sent', onSelect: () => { void run(() => api.post(`/quotes/${d.id}/decline`, {}), 'Marked as declined.'); } }]}
          />
        </div>
      </section>

      {d.status === 'draft' && (
        <SidePanel
          open={panel === 'send'}
          title="Send the quotation"
          onClose={closePanel}
          footer={<><button type="button" className="quiet" onClick={closePanel}>Cancel</button><button type="submit" form={SEND_FORM} disabled={busy}>Send and number it</button></>}
        >
          <form id={SEND_FORM} className="stack" onSubmit={submitIn(() => api.post(`/quotes/${d.id}/send`, to.trim() ? { to } : {}), 'Sent. It now has its number and can no longer be changed. Email is not connected, so nothing was actually sent (practice mode).')}>
            <ErrorNote error={error} />
            <div className="field"><label htmlFor="qe">Send to email address (optional)</label><input id="qe" type="email" placeholder="client@example.com" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <p className="muted small">Sending gives the quotation its number and locks it. Email is not connected yet, so a message is only kept under <Link href="/billing/outbox">Sent emails</Link> (practice mode).</p>
          </form>
        </SidePanel>
      )}

      {canFee && (
        <SidePanel
          open={panel === 'fee'}
          title="Use it as the engagement fee"
          onClose={closePanel}
          footer={<><button type="button" className="quiet" onClick={closePanel}>Cancel</button><button type="submit" form={FEE_FORM} disabled={busy}>Set the fee</button></>}
        >
          <form id={FEE_FORM} className="stack" onSubmit={submitIn(() => api.post(`/quotes/${d.id}/apply-fee`, { engagementId }), 'The fixed fee on the engagement is now the quotation amount.')}>
            <ErrorNote error={error} />
            <p className="muted">Sets the fixed fee of an engagement for this client to {kes(d.subtotal)} (before tax).</p>
            <div className="field">
              <label htmlFor="qg">Engagement</label>
              <select id="qg" required value={engagementId} onChange={(e) => setEngagementId(e.target.value)}>
                <option value="">Choose the engagement</option>
                {mine.map((g) => <option key={g.id} value={g.id}>Year ended {g.periodEnd}</option>)}
              </select>
            </div>
          </form>
        </SidePanel>
      )}
    </div>
  );
}
