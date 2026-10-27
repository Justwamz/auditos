import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { formatMoney } from '@auditos/fs-engine';
import { withTenant } from '@auditos/db';
import { actorOf, tenantCtx } from '../authz';
import { canSeeBilling } from './settings';
import { timeValue } from './time';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'not a real date');
const range = z
  .object({ from: day, to: day })
  .refine((q) => q.to >= q.from, { message: 'to must not be before from', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 366, { message: 'ask for at most a year', path: ['to'] });

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 100));
const m = (v: bigint) => formatMoney(v);

interface TimeRow { user_id: string; name: string; engagement_id: string | null; client_name: string | null; minutes: number; billable: boolean; rate: string }

/** Billable summaries. Each person gets what their role allows: staff their own hours only, managers their engagements, partners the firm, administrators invoicing. */
export async function summaryRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  app.get('/billing/summary', { config: { access: 'tenant' } }, async (req) => {
    const q = range.parse(req.query);
    const actor = actorOf(req);
    const ctx = tenantCtx(req);
    const sees = canSeeBilling(req);
    const seesTime = actor.role === 'partner' || actor.role === 'manager';

    return withTenant(pool, ctx, async (tx) => {
      const out: Record<string, unknown> = { range: q };

      if (actor.role !== 'firm_admin') {
        const mine = (await tx.query('select coalesce(sum(minutes), 0)::int as total, coalesce(sum(minutes) filter (where billable), 0)::int as billable from time_entries where user_id = $1 and work_date between $2::date and $3::date', [ctx.userId, q.from, q.to])).rows[0] as { total: number; billable: number };
        out.mine = { minutes: mine.total, billableMinutes: mine.billable, utilisation: pct(mine.billable, mine.total) };
      }
      if (!sees) return out;

      if (seesTime) {
        const rows = (
          await tx.query(
            `select t.user_id, coalesce(u.full_name, u.email) as name, t.engagement_id, c.name as client_name, t.minutes, t.billable, t.rate_cents::text as rate
               from time_entries t join users u on u.id = t.user_id
               left join engagements e on e.id = t.engagement_id left join clients c on c.id = e.client_id
              where t.work_date between $1::date and $2::date`,
            [q.from, q.to],
          )
        ).rows as TimeRow[];
        const people = new Map<string, { userId: string; name: string; minutes: number; billable: number; value: bigint }>();
        const engagements = new Map<string, { engagementId: string; clientName: string; minutes: number; billable: number; value: bigint }>();
        let minutes = 0;
        let billable = 0;
        let value = 0n;
        for (const r of rows) {
          const v = r.billable ? timeValue(r.minutes, BigInt(r.rate)) : 0n;
          minutes += r.minutes;
          if (r.billable) billable += r.minutes;
          value += v;
          const p = people.get(r.user_id) ?? { userId: r.user_id, name: r.name, minutes: 0, billable: 0, value: 0n };
          p.minutes += r.minutes;
          if (r.billable) p.billable += r.minutes;
          p.value += v;
          people.set(r.user_id, p);
          if (r.engagement_id) {
            const e = engagements.get(r.engagement_id) ?? { engagementId: r.engagement_id, clientName: r.client_name ?? '', minutes: 0, billable: 0, value: 0n };
            e.minutes += r.minutes;
            if (r.billable) e.billable += r.minutes;
            e.value += v;
            engagements.set(r.engagement_id, e);
          }
        }
        const ids = [...engagements.keys()];
        const used = new Map<string, number>(
          ids.length === 0 ? [] : (await tx.query('select engagement_id, sum(minutes)::int as minutes from time_entries where engagement_id = any($1::uuid[]) group by 1', [ids])).rows.map((r) => [r.engagement_id as string, r.minutes as number]),
        );
        const fees = new Map<string, { basis: string; flat: string | null; hours: number | null }>(
          ids.length === 0 ? [] : (await tx.query('select engagement_id, basis, flat_fee_cents::text as flat, budget_hours::float8 as hours from engagement_fees where engagement_id = any($1::uuid[])', [ids])).rows.map((r) => [r.engagement_id as string, { basis: r.basis as string, flat: r.flat as string | null, hours: r.hours as number | null }]),
        );
        out.time = {
          minutes, billableMinutes: billable, utilisation: pct(billable, minutes), value: m(value),
          byPerson: [...people.values()].sort((a, b) => b.minutes - a.minutes).map((p) => ({ userId: p.userId, name: p.name, minutes: p.minutes, billableMinutes: p.billable, utilisation: pct(p.billable, p.minutes), value: m(p.value) })),
          byEngagement: [...engagements.values()].sort((a, b) => b.minutes - a.minutes).map((e) => {
            const f = fees.get(e.engagementId);
            const hoursUsed = Math.round(((used.get(e.engagementId) ?? 0) / 60) * 10) / 10;
            return {
              engagementId: e.engagementId, clientName: e.clientName, minutes: e.minutes, billableMinutes: e.billable, value: m(e.value),
              feeBasis: f?.basis ?? null, flatFee: f?.flat == null ? null : m(BigInt(f.flat)), budgetHours: f?.hours ?? null, hoursUsed,
              budgetUsedPercent: f?.hours ? pct(hoursUsed, f.hours) : null,
            };
          }),
        };

        const wipTime = (await tx.query('select minutes, rate_cents::text as rate from time_entries where billable and invoice_id is null and engagement_id is not null')).rows as { minutes: number; rate: string }[];
        const wipExp = (await tx.query('select coalesce(sum(amount_cents), 0)::text as total from engagement_expenses where rebillable and invoice_id is null')).rows[0].total as string;
        const wt = wipTime.reduce((n, r) => n + timeValue(r.minutes, BigInt(r.rate)), 0n);
        out.wip = { time: m(wt), expenses: m(BigInt(wipExp)), total: m(wt + BigInt(wipExp)) };

        const stages = (await tx.query("select stage, count(*)::int as n, coalesce(sum(expected_fee_cents), 0)::text as cents from prospects group by stage")).rows as { stage: string; n: number; cents: string }[];
        const open = stages.filter((s) => !['won', 'lost'].includes(s.stage));
        out.pipeline = {
          open: { count: open.reduce((n, s) => n + s.n, 0), value: m(open.reduce((n, s) => n + BigInt(s.cents), 0n)) },
          byStage: Object.fromEntries(stages.map((s) => [s.stage, { count: s.n, value: m(BigInt(s.cents)) }])),
        };
      }

      const today = "(now() at time zone 'Africa/Nairobi')::date";
      const issued = (await tx.query("select count(*)::int as n, coalesce(sum(total_cents), 0)::text as total from invoices where status in ('sent', 'part_paid', 'paid') and issue_date between $1::date and $2::date", [q.from, q.to])).rows[0];
      const collected = (await tx.query('select coalesce(sum(amount_cents), 0)::text as total from invoice_payments where paid_on between $1::date and $2::date', [q.from, q.to])).rows[0].total as string;
      const open = (await tx.query("select count(*)::int as n, coalesce(sum(total_cents - paid_cents), 0)::text as total from invoices where status in ('sent', 'part_paid')")).rows[0];
      const overdue = (await tx.query(`select count(*)::int as n, coalesce(sum(total_cents - paid_cents), 0)::text as total from invoices where status in ('sent', 'part_paid') and due_date < ${today}`)).rows[0];
      const drafts = (await tx.query("select count(*)::int as n from invoices where status = 'draft'")).rows[0].n as number;
      out.invoicing = {
        issued: { count: issued.n as number, total: m(BigInt(issued.total)) },
        collected: m(BigInt(collected)),
        outstanding: { count: open.n as number, total: m(BigInt(open.total)) },
        overdue: { count: overdue.n as number, total: m(BigInt(overdue.total)) },
        drafts,
      };
      return out;
    });
  });
}
