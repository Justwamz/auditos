'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Notice } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { statusLabel } from '@/components/billing';
import { kes } from '@/lib/dates';
import { saveBlob } from '@/lib/download';

interface Quote {
  id: string; number: string | null; status: string; clientId: string | null; subjectName: string; title: string; validUntil: string | null; notes: string | null; taxMode: string;
  taxes: { name: string; rate: string; amount: string }[]; subtotal: string; taxTotal: string; total: string;
  lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
}

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<Quote>(`/quotes/${id}`);
  const engagements = useApi<{ engagements: { id: string; clientId: string; clientName: string; periodEnd: string; member: boolean }[] }>('/engagements');
  const [to, setTo] = useState('');
  const [engagementId, setEngagementId] = useState('');
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');

  async function run(fn: () => Promise<unknown>, message = '') {
    setError(undefined);
    setInfo('');
    try {
      await fn();
      if (message) setInfo(message);
      q.reload();
    } catch (e) {
      setError(e);
    }
  }

  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <p className="muted">Loading quotation…</p>;
  const d = q.data;
  const mine = engagements.data?.engagements.filter((e) => e.member && e.clientId === d.clientId) ?? [];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="small"><Link href="/quotes">Quotations</Link></p>
        <div className="row between"><h1>{d.number ? `Quotation ${d.number}` : 'Draft quotation'}</h1><HelpLink topic="quotes" /></div>
        <p>{d.subjectName} · {d.title} · {statusLabel(d.status)}{d.validUntil ? ` · valid until ${d.validUntil}` : ''}</p>
      </div>
      <ErrorNote error={error} />
      {info && <Notice>{info}</Notice>}

      <section className="sheet stack">
        <table className="lines">
          <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>{d.lines.map((l, n) => <tr key={n}><td>{l.description}</td><td className="num">{Number(l.quantity).toFixed(2)}</td><td className="num">{kes(l.unitPrice)}</td><td className="num">{kes(l.amount)}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={3} className="num">{d.taxMode === 'inclusive' && d.taxes.length > 0 ? 'Amount before tax' : 'Subtotal'}</td><td className="num">{kes(d.subtotal)}</td></tr>
            {d.taxes.map((t) => <tr key={t.name}><td colSpan={3} className="num">{t.name} {t.rate}%{d.taxMode === 'inclusive' ? ' (included)' : ''}</td><td className="num">{kes(t.amount)}</td></tr>)}
            <tr><td colSpan={3} className="num"><strong>Total</strong></td><td className="num"><strong>{kes(d.total)}</strong></td></tr>
          </tfoot>
        </table>
        <div className="row">
          <button className="secondary" onClick={() => run(async () => { const f = await api.downloadGet(`/quotes/${d.id}/pdf`); saveBlob(f.blob, f.filename); })}>Download PDF</button>
          {d.status === 'sent' && <button onClick={() => run(() => api.post(`/quotes/${d.id}/accept`, {}), 'Marked as accepted.')}>Mark as accepted</button>}
          {d.status === 'sent' && <button className="danger" onClick={() => run(() => api.post(`/quotes/${d.id}/decline`, {}), 'Marked as declined.')}>Mark as declined</button>}
        </div>
      </section>

      {d.status === 'draft' && (
        <form className="sheet stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.post(`/quotes/${d.id}/send`, to.trim() ? { to } : {}), 'Sent. It now has its number and can no longer be changed. Email is simulated, so nothing was actually delivered.'); }}>
          <h2>Send the quotation</h2>
          <div className="row">
            <input aria-label="Send to email address" type="email" placeholder="client@example.com (optional)" value={to} onChange={(e) => setTo(e.target.value)} />
            <button>Send and number it</button>
          </div>
          <p className="muted small">Email is not connected yet: the message is kept in the <Link href="/billing/outbox">outbox</Link>.</p>
        </form>
      )}

      {d.status === 'accepted' && d.clientId && (
        <form className="sheet stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => api.post(`/quotes/${d.id}/apply-fee`, { engagementId }), 'The fixed fee on the engagement is now the quotation amount.'); }}>
          <h2>Use it as the engagement fee</h2>
          <p className="muted">Sets the fixed fee of an engagement for this client to {kes(d.subtotal)} (before tax).</p>
          <div className="row">
            <select aria-label="Engagement" required value={engagementId} onChange={(e) => setEngagementId(e.target.value)}>
              <option value="">Choose the engagement</option>
              {mine.map((g) => <option key={g.id} value={g.id}>Year ended {g.periodEnd}</option>)}
            </select>
            <button className="secondary">Set the fee</button>
          </div>
        </form>
      )}
    </div>
  );
}
