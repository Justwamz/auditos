'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { statusLabel } from '@/components/billing';
import { kes } from '@/lib/dates';

interface Row { id: string; number: string | null; status: string; subjectName: string; title: string; validUntil: string | null; total: string; createdBy: string }

export default function QuotesPage() {
  const list = useApi<{ quotes: Row[] }>('/quotes');
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>Quotations</h1><HelpLink topic="quotes" /></div>
        <p>Price a job for a client or a prospect. Sending numbers the quotation; when it is accepted, its amount can become the engagement's fixed fee.</p>
      </div>
      <div className="row between"><span /><Link href="/quotes/new" className="button">New quotation</Link></div>
      <ErrorNote error={list.error} />
      <section className="sheet">
        {list.data?.quotes.length === 0 && <Empty>No quotations yet.</Empty>}
        {list.data && list.data.quotes.length > 0 && (
          <table>
            <thead><tr><th>Number</th><th>For</th><th>Title</th><th>Status</th><th>Valid until</th><th>Total</th><th>By</th></tr></thead>
            <tbody>
              {list.data.quotes.map((q) => (
                <tr key={q.id}>
                  <td><Link href={`/quotes/${q.id}`}>{q.number ?? 'Draft'}</Link></td><td>{q.subjectName}</td><td>{q.title}</td><td>{statusLabel(q.status)}</td>
                  <td>{q.validUntil ?? ''}</td><td>{kes(q.total)}</td><td>{q.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
