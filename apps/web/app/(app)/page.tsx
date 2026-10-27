'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Empty, StateBadge } from '@/components/bits';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';
import { WhatYouSee } from '@/components/WhatYouSee';

interface Dash {
  engagements: { id: string; clientName: string; sector: string; periodEnd: string; state: string }[];
  awaitingReview: { id: string; title: string; engagementId: string; clientName: string; level: string }[];
  myDrafts: { id: string; title: string; engagementId: string; clientName: string }[];
  openNotes: number;
}
interface Me { email: string; role: string }

export default function Dashboard() {
  const dash = useApi<Dash>('/dashboard');
  const me = useApi<Me>('/me');
  const d = dash.data;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Dashboard</h1>
        <p>{me.data ? `Signed in as ${me.data.email}.` : ''}</p>
      </div>
      <ErrorNote error={dash.error} />
      <WhatYouSee />

      {d && d.openNotes > 0 && (
        <div className="notice warn">
          {d.openNotes} open review {d.openNotes === 1 ? 'note is' : 'notes are'} waiting across your engagements.
        </div>
      )}

      {d && d.awaitingReview.length > 0 && (
        <section className="sheet">
          <h2>Waiting for your review</h2>
          <table>
            <thead><tr><th>Paper</th><th>Client</th><th>Needs</th></tr></thead>
            <tbody>
              {d.awaitingReview.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/engagements/${i.engagementId}?tab=papers&item=${i.id}`}>{i.title}</Link></td>
                  <td>{i.clientName}</td>
                  <td>{i.level === 'manager' ? 'Manager review' : 'Partner approval'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d && d.myDrafts.length > 0 && (
        <section className="sheet">
          <h2>Your drafts</h2>
          <table>
            <thead><tr><th>Paper</th><th>Client</th></tr></thead>
            <tbody>
              {d.myDrafts.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/engagements/${i.engagementId}?tab=papers&item=${i.id}`}>{i.title}</Link></td>
                  <td>{i.clientName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="sheet">
        <div className="row between"><h2>Your engagements</h2><Link href="/engagements">All engagements</Link></div>
        {d && d.engagements.length === 0 && <Empty>You are not on any engagement yet. A manager or partner can add you from an engagement’s team list.</Empty>}
        {d && d.engagements.length > 0 && (
          <table>
            <thead><tr><th>Client</th><th>Sector</th><th>Year end</th><th>Stage</th></tr></thead>
            <tbody>
              {d.engagements.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/engagements/${e.id}`}>{e.clientName}</Link></td>
                  <td>{SECTOR_LABELS[e.sector] ?? e.sector}</td>
                  <td>{fmtDate(e.periodEnd)}</td>
                  <td><StateBadge state={e.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
