'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { Empty, ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';

interface Message { id: string; kind: string; to: string; subject: string; body: string; sentBy: string; at: string; provider: string }

export default function OutboxPage() {
  const box = useApi<{ messages: Message[] }>('/outbox');
  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="small"><Link href="/billing">Billing</Link></p>
        <div className="row between"><h1>Outbox</h1><HelpLink topic="billing" /></div>
        <p>Messages the system would email to clients. Email is not connected yet, so none of these were delivered: this is where you can see what would have been sent.</p>
      </div>
      <ErrorNote error={box.error} />
      {box.data?.messages.length === 0 && <Empty>Nothing in the outbox.</Empty>}
      {box.data?.messages.map((m) => (
        <article key={m.id} className="sheet stack">
          <div className="row between">
            <strong>{m.subject}</strong>
            <span className="small muted">Not delivered (simulated) · {new Date(m.at).toLocaleString('en-GB')}</span>
          </div>
          <div className="small muted">To {m.to} · prepared by {m.sentBy}</div>
          <pre className="mail">{m.body}</pre>
        </article>
      ))}
    </div>
  );
}
