'use client';
import { BillingTabs } from '@/components/BillingTabs';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { Disclosure } from '@/components/ui/Disclosure';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';
import { mailText } from '@/lib/billing';

interface Message { id: string; kind: string; to: string; subject: string; body: string; sentBy: string; at: string; provider: string }

export default function SentEmailsPage() {
  const box = useApi<{ messages: Message[] }>('/outbox');
  const loading = box.loading && !box.data;
  return (
    <div className="stack-lg">
      <PageHead
        title="Sent emails"
        sentence="Emails you asked to send to clients are kept here. Email is not connected yet, so none of them were actually sent."
        help={<HelpLink topic="billing" />}
      />
      <BillingTabs />
      <ErrorNote error={box.error} />
      {loading && !box.error && (
        <section className="sheet prospects-loading" aria-label="Loading sent emails">
          <Skeleton height={48} />
          <Skeleton height={48} />
        </section>
      )}
      {box.data?.messages.length === 0 && (
        <section className="sheet">
          <EmptyState kind="ledger" title="No emails yet">When you send an invoice or a quotation, the email is kept here.</EmptyState>
        </section>
      )}
      {box.data && box.data.messages.length > 0 && (
        <section className="sheet stack" aria-label="Emails">
          {box.data.messages.map((m) => (
            <div key={m.id} className="mail-item">
              <Disclosure
                summary={
                  <span className="mail-summary">
                    <span className="mail-subject">{m.subject}</span>
                    <span className="small muted">To {m.to}</span>
                    <span className="small muted">{new Date(m.at).toLocaleString('en-GB')}</span>
                    <span className="practice-tag">Not actually sent (practice mode)</span>
                  </span>
                }
              >
                <div className="small muted">Prepared by {m.sentBy}</div>
                <pre className="mail">{mailText(m.body)}</pre>
              </Disclosure>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
