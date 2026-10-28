'use client';
import Link from 'next/link';
import { BillingTabs } from '@/components/BillingTabs';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { statusLabel } from '@/components/billing';
import { kes } from '@/lib/dates';

interface Row {
  id: string; number: string | null; status: string; overdue: boolean; clientName: string; issueDate: string | null; dueDate: string | null; total: string; outstanding: string;
  tax: { simulated: boolean; status: string } | null;
}
const FILTERS = [
  { id: '', label: 'All' }, { id: 'draft', label: 'Drafts' }, { id: 'open', label: 'Open (sent or part paid)' }, { id: 'overdue', label: 'Overdue' }, { id: 'paid', label: 'Paid' }, { id: 'void', label: 'Void' },
];

export default function InvoicesPage() {
  const [filter, setFilter] = useState('');
  const list = useApi<{ invoices: Row[] }>(`/invoices${filter ? `?status=${filter}` : ''}`);
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>Invoices</h1><HelpLink topic="invoices" /></div>
        <p>Invoices start as drafts. A partner or administrator issues them, which numbers and locks them. Until KRA is connected, every issued invoice is marked as a simulation.</p>
      </div>
      <BillingTabs />
      <div className="row between">
        <div className="row">
          <label htmlFor="inf" className="small">Show</label>
          <select id="inf" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>{FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
        </div>
        <Link href="/invoices/new" className="button">New invoice</Link>
      </div>
      <ErrorNote error={list.error} />
      <section className="sheet">
        {list.data?.invoices.length === 0 && <Empty>No invoices here yet.</Empty>}
        {list.data && list.data.invoices.length > 0 && (
          <table>
            <thead><tr><th>Number</th><th>Client</th><th>Status</th><th>Issued</th><th>Due</th><th>Total</th><th>Owed</th></tr></thead>
            <tbody>
              {list.data.invoices.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/invoices/${i.id}`}>{i.number ?? 'Draft'}</Link></td>
                  <td>{i.clientName}</td>
                  <td>{statusLabel(i.status, i.overdue)}{i.tax?.simulated && <span className="small muted"> · simulation</span>}</td>
                  <td>{i.issueDate ?? ''}</td><td>{i.dueDate ?? ''}</td><td>{kes(i.total)}</td><td>{i.status === 'draft' || i.status === 'void' ? '' : kes(i.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
