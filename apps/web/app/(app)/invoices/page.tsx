'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BillingTabs } from '@/components/BillingTabs';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { PracticeTag, statusLabel } from '@/components/billing';
import { Chips } from '@/components/ui/Chips';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { matchesQuery } from '@/lib/text-match';
import { kes } from '@/lib/dates';
import { TableScroll } from '@/components/ui/TableScroll';

interface Row {
  id: string; number: string | null; status: string; overdue: boolean; clientName: string; issueDate: string | null; dueDate: string | null; total: string; outstanding: string;
  tax: { simulated: boolean; status: string } | null;
}
const FILTERS = [
  { id: '', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'open', label: 'Open', hint: 'Sent or part paid' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paid', label: 'Paid' },
  { id: 'void', label: 'Void' },
];

export default function InvoicesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const list = useApi<{ invoices: Row[] }>(`/invoices${filter ? `?status=${filter}` : ''}`);
  const all = useMemo(() => list.data?.invoices ?? [], [list.data]);
  const rows = useMemo(() => all.filter((i) => matchesQuery(query, i.number, i.clientName, statusLabel(i.status, i.overdue))), [all, query]);
  const loading = list.loading && !list.data;

  return (
    <div className="stack-lg">
      <PageHead
        title="Invoices"
        sentence="Invoices start as drafts. A partner or administrator issues them, which numbers and locks them. Until KRA is connected, every issued invoice is for practice only."
        action={<Link href="/invoices/new" className="button">+ New invoice</Link>}
        help={<HelpLink topic="invoices" />}
      />
      <BillingTabs />
      <ErrorNote error={list.error} />

      <div className="prospects-toolbar">
        <Chips label="Filter invoices" value={filter} onChange={setFilter} options={FILTERS} />
        <input type="search" className="prospects-search" aria-label="Search invoices" placeholder="Search by number or client" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading && !list.error && (
        <section className="sheet prospects-loading" aria-label="Loading invoices">
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}

      {list.data && all.length === 0 && (
        <section className="sheet">
          <EmptyState kind="ledger" title={filter ? 'No invoices with this status' : 'No invoices yet'}>
            {filter ? 'Choose All to see every invoice.' : 'Use + New invoice at the top to start one.'}
          </EmptyState>
        </section>
      )}

      {all.length > 0 && rows.length === 0 && (
        <section className="sheet">
          <EmptyState kind="folder" title="No invoices match" action={<button type="button" className="secondary" onClick={() => setQuery('')}>Show everything</button>}>
            Try a different word.
          </EmptyState>
        </section>
      )}

      {rows.length > 0 && (
        <section className="sheet prospects-sheet">
          <TableScroll label="Invoices list">
            <table className="prospects-table" aria-label="Invoices">
              <thead><tr><th>Number</th><th>Client</th><th>Status</th><th>Issued</th><th>Due</th><th className="num">Total</th><th className="num">Owed</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="prospects-row" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) router.push(`/invoices/${i.id}`); }}>
                    <td className="nowrap"><Link href={`/invoices/${i.id}`}>{i.number ?? 'Draft'}</Link></td>
                    <td>{i.clientName}</td>
                    <td>{statusLabel(i.status, i.overdue)}{i.tax?.simulated && <PracticeTag />}</td>
                    <td className="nowrap">{i.issueDate ?? ''}</td>
                    <td className="nowrap">{i.dueDate ?? ''}</td>
                    <td className="num">{kes(i.total)}</td>
                    <td className="num">{i.status === 'draft' || i.status === 'void' ? '' : kes(i.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </section>
      )}
    </div>
  );
}
