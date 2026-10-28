'use client';
import Link from 'next/link';
import { BillingTabs } from '@/components/BillingTabs';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { ErrorNote } from '@/components/bits';
import { HelpLink } from '@/components/HelpLink';
import { hoursLabel, kes, monthEnd, monthStart, todayNairobi } from '@/lib/dates';

interface Summary {
  mine?: { minutes: number; billableMinutes: number; utilisation: number };
  time?: {
    minutes: number; billableMinutes: number; utilisation: number; value: string;
    byPerson: { userId: string; name: string; minutes: number; billableMinutes: number; utilisation: number; value: string }[];
    byEngagement: { engagementId: string; clientName: string; minutes: number; value: string; feeBasis: string | null; flatFee: string | null; budgetHours: number | null; hoursUsed: number; budgetUsedPercent: number | null }[];
  };
  wip?: { time: string; expenses: string; total: string };
  invoicing?: { issued: { count: number; total: string }; collected: string; outstanding: { count: number; total: string }; overdue: { count: number; total: string }; drafts: number };
  pipeline?: { open: { count: number; value: string } };
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="tile">
      <div className="small muted">{label}</div>
      <div className="tile-value">{value}</div>
      {note && <div className="small muted">{note}</div>}
    </div>
  );
}

export default function BillingPage() {
  const [from, setFrom] = useState(() => monthStart(todayNairobi()));
  const [to, setTo] = useState(() => monthEnd(todayNairobi()));
  const s = useApi<Summary>(`/billing/summary?from=${from}&to=${to}`);
  const me = useApi<{ role: string; isAdmin: boolean }>('/me');
  const manage = me.data?.role === 'partner' || me.data?.role === 'firm_admin' || me.data?.isAdmin;
  const d = s.data;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row between"><h1>Billing</h1><HelpLink topic="billing" /></div>
        <p>Hours, work in progress, invoices and what is owed. You see the engagements you work on{me.data?.role === 'partner' ? ', and the whole firm as a partner' : ''}.</p>
      </div>
      <BillingTabs />
      <ErrorNote error={s.error} />

      <section className="sheet row between">
        <div className="row">
          <label className="small" htmlFor="bf">From</label><input id="bf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="small" htmlFor="bt">To</label><input id="bt" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="row">
          <Link href="/invoices">Invoices</Link>
          <Link href="/quotes">Quotations</Link>
          <Link href="/billing/outbox">Sent emails</Link>
          {manage && <Link href="/billing/settings">Rates, taxes and settings</Link>}
        </div>
      </section>

      {d?.invoicing && (
        <section className="tiles" aria-label="Invoicing">
          <Tile label="Invoiced in this period" value={kes(d.invoicing.issued.total)} note={`${d.invoicing.issued.count} invoice(s)`} />
          <Tile label="Collected in this period" value={kes(d.invoicing.collected)} />
          <Tile label="Still owed to the firm" value={kes(d.invoicing.outstanding.total)} note={`${d.invoicing.outstanding.count} invoice(s)`} />
          <Tile label="Overdue" value={kes(d.invoicing.overdue.total)} note={`${d.invoicing.overdue.count} invoice(s)`} />
          <Tile label="Drafts waiting" value={String(d.invoicing.drafts)} />
        </section>
      )}

      {d?.time && d.wip && (
        <section className="tiles" aria-label="Time">
          <Tile label="Hours logged" value={hoursLabel(d.time.minutes)} note={`${hoursLabel(d.time.billableMinutes)} billable`} />
          <Tile label="Utilisation" value={`${d.time.utilisation}%`} note="billable share of hours" />
          <Tile label="Billable value" value={kes(d.time.value)} note="at the rate when logged" />
          <Tile label="Not yet invoiced" value={kes(d.wip.total)} note={`time ${kes(d.wip.time)} · expenses ${kes(d.wip.expenses)}`} />
          {d.pipeline && <Tile label="Open pipeline" value={kes(d.pipeline.open.value)} note={`${d.pipeline.open.count} prospect(s)`} />}
        </section>
      )}

      {d?.time && d.time.byEngagement.length > 0 && (
        <section className="sheet">
          <h2>By engagement</h2>
          <table>
            <thead><tr><th>Client</th><th>Hours</th><th>Value</th><th>Fee</th><th>Budget used</th></tr></thead>
            <tbody>
              {d.time.byEngagement.map((e) => (
                <tr key={e.engagementId}>
                  <td><Link href={`/engagements/${e.engagementId}`}>{e.clientName}</Link></td>
                  <td>{hoursLabel(e.minutes)}</td>
                  <td>{kes(e.value)}</td>
                  <td>{e.feeBasis === 'flat' ? `Flat ${kes(e.flatFee)}` : e.feeBasis === 'hourly' ? 'Hourly' : 'Not set'}</td>
                  <td>{e.budgetHours ? `${e.hoursUsed} of ${e.budgetHours} h (${e.budgetUsedPercent}%)` : `${e.hoursUsed} h, no budget`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d?.time && d.time.byPerson.length > 0 && (
        <section className="sheet">
          <h2>By person</h2>
          <table>
            <thead><tr><th>Person</th><th>Hours</th><th>Billable</th><th>Utilisation</th><th>Value</th></tr></thead>
            <tbody>
              {d.time.byPerson.map((p) => (
                <tr key={p.userId}><td>{p.name}</td><td>{hoursLabel(p.minutes)}</td><td>{hoursLabel(p.billableMinutes)}</td><td>{p.utilisation}%</td><td>{kes(p.value)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d && !d.time && d.invoicing && <p className="muted">As an administrator you see invoicing. Hours and values are visible to managers and partners.</p>}
    </div>
  );
}
