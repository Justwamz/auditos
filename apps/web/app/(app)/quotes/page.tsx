'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BillingTabs } from '@/components/BillingTabs';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { statusLabel } from '@/components/billing';
import { Chips } from '@/components/ui/Chips';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { matchesQuery } from '@/lib/billing';
import { kes } from '@/lib/dates';

interface Row { id: string; number: string | null; status: string; subjectName: string; title: string; validUntil: string | null; total: string; createdBy: string }
const FILTERS = [
  { id: '', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'sent', label: 'Sent' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
];

export default function QuotesPage() {
  const router = useRouter();
  const list = useApi<{ quotes: Row[] }>('/quotes');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const all = useMemo(() => list.data?.quotes ?? [], [list.data]);
  const options = useMemo(() => FILTERS.map((f) => ({ ...f, count: f.id ? all.filter((q) => q.status === f.id).length : all.length })), [all]);
  const byStatus = useMemo(() => (filter ? all.filter((q) => q.status === filter) : all), [all, filter]);
  const rows = useMemo(() => byStatus.filter((q) => matchesQuery(query, q.number, q.subjectName, q.title, q.createdBy)), [byStatus, query]);
  const loading = list.loading && !list.data;

  return (
    <div className="stack-lg">
      <PageHead
        title="Quotations"
        sentence="Price a job for a client or a prospect. Sending numbers the quotation; when it is accepted, its amount can become the engagement's fixed fee."
        action={<Link href="/quotes/new" className="button">+ New quotation</Link>}
        help={<HelpLink topic="quotes" />}
      />
      <BillingTabs />
      <ErrorNote error={list.error} />

      <div className="prospects-toolbar">
        <Chips label="Filter quotations" value={filter} onChange={setFilter} options={options} />
        <input type="search" className="prospects-search" aria-label="Search quotations" placeholder="Search by number, client or title" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading && !list.error && (
        <section className="sheet prospects-loading" aria-label="Loading quotations">
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}

      {list.data && all.length === 0 && (
        <section className="sheet">
          <EmptyState kind="ledger" title="No quotations yet">Use + New quotation at the top to price a job.</EmptyState>
        </section>
      )}

      {all.length > 0 && rows.length === 0 && (
        <section className="sheet">
          <EmptyState kind="folder" title="No quotations match" action={<button type="button" className="secondary" onClick={() => { setQuery(''); setFilter(''); }}>Show everything</button>}>
            Try a different word or status.
          </EmptyState>
        </section>
      )}

      {rows.length > 0 && (
        <section className="sheet prospects-sheet">
          <div className="prospects-scroll">
            <table className="prospects-table" aria-label="Quotations">
              <thead><tr><th>Number</th><th>For</th><th>Title</th><th>Status</th><th>Valid until</th><th className="num">Total</th><th>By</th></tr></thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} className="prospects-row" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) router.push(`/quotes/${q.id}`); }}>
                    <td className="nowrap"><Link href={`/quotes/${q.id}`}>{q.number ?? 'Draft'}</Link></td>
                    <td>{q.subjectName}</td>
                    <td>{q.title}</td>
                    <td>{statusLabel(q.status)}</td>
                    <td className="nowrap">{q.validUntil ?? ''}</td>
                    <td className="num">{kes(q.total)}</td>
                    <td>{q.createdBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
