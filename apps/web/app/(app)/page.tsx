'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { ErrorNote, Empty, StateBadge } from '@/components/bits';
import { fmtDate, SECTOR_LABELS } from '@/lib/text';
import { HelpLink } from '@/components/HelpLink';
import { WhatYouSee } from '@/components/WhatYouSee';
import { useMe } from '@/components/Me';
import { PageHead } from '@/components/ui/PageHead';
import { EmptyState, Skeleton } from '@/components/ui/EmptyState';
import { addDays, today as todayNairobi } from '@/lib/calendar';
import { buildToday, greetingFor } from '@/lib/today';
import { TableScroll } from '@/components/ui/TableScroll';

interface Dash {
  engagements: { id: string; clientName: string; sector: string; periodEnd: string; state: string }[];
  awaitingReview: { id: string; title: string; engagementId: string; clientName: string; level: string }[];
  myDrafts: { id: string; title: string; engagementId: string; clientName: string }[];
  openNotes: number;
}
interface Summary { overdue?: { count: number; total: string } }
interface Cal { milestones: { date: string; title: string; engagementId: string }[] }

const BILLING_ROLES = ['partner', 'manager', 'firm_admin'];


export default function Today() {
  const router = useRouter();
  const { role, isAdmin } = useMe();
  const gone = role === 'firm_admin';
  const [day, setDay] = useState<string>();
  const [now, setNow] = useState<Date>();
  useEffect(() => {
    setDay(todayNairobi());
    setNow(new Date());
  }, []);
  useEffect(() => {
    if (gone) router.replace('/clients');
  }, [gone, router]);

  const seesBilling = isAdmin || BILLING_ROLES.includes(role);
  const dash = useApi<Dash>(gone ? null : '/dashboard');
  const me = useApi<{ fullName: string | null }>(gone ? null : '/me');
  const summary = useApi<Summary>(gone || !seesBilling || !day ? null : `/billing/summary?from=${addDays(day, -30)}&to=${day}`);
  const cal = useApi<Cal>(gone || !day ? null : `/calendar?from=${day}&to=${addDays(day, 14)}`);

  if (gone) return null;

  const d = dash.data;
  const settled = (x: { data: unknown; error: unknown }) => !!x.data || !!x.error;
  const ready = !!d && !!day && !!now && settled(me) && settled(cal) && (!seesBilling || settled(summary));
  const sideError = me.error ?? cal.error ?? summary.error;
  const rows = ready
    ? buildToday({
        role, isAdmin, awaitingReview: d.awaitingReview, myDrafts: d.myDrafts, openNotes: d.openNotes,
        overdue: summary.data?.overdue, milestones: cal.data?.milestones ?? [], today: day,
      })
    : [];
  const first = me.data?.fullName?.trim().split(/\s+/)[0];
  const title = now ? `${greetingFor(now)}${first ? `, ${first}` : ''}` : 'Hello';
  const dateText = now ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now) : '';

  return (
    <div className="stack-lg">
      <PageHead
        title={title}
        sentence={dateText ? `${dateText}. Here is what needs you today.` : 'Here is what needs you today.'}
        help={<HelpLink topic="dashboard" />}
      />
      <ErrorNote error={dash.error ?? sideError} />

      <section className="today-list" aria-label="Needs you today">
        {!ready && !dash.error && (
          <>
            <Skeleton height={72} className="today-skeleton" />
            <Skeleton height={72} className="today-skeleton" />
            <Skeleton height={72} className="today-skeleton" />
          </>
        )}
        {ready && rows.length === 0 && (
          <EmptyState kind="calendar" title="Nothing needs you today.">Enjoy the quiet.</EmptyState>
        )}
        {rows.map((r) => (
          <div key={r.id} className={`today-card ${r.tone}`}>
            <p>{r.text}</p>
            <Link href={r.href} className="button" aria-label={`Open: ${r.text}`}>Open</Link>
          </div>
        ))}
      </section>

      <section className="sheet">
        <div className="row between"><h2>Your engagements</h2><Link href="/engagements">All engagements</Link></div>
        {!d && !dash.error && <Skeleton height={64} />}
        {d && d.engagements.length === 0 && <Empty>You are not on any engagement yet. A manager or partner can add you from an engagement’s team list.</Empty>}
        {d && d.engagements.length > 0 && (
          <TableScroll label="Your engagements"><table>
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
          </table></TableScroll>
        )}
      </section>

      <WhatYouSee />
    </div>
  );
}
