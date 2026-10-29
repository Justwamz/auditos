import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { exportBillingPdf } from '@auditos/exports';
import { withTenant } from '@auditos/db';
import { httpError, tenantCtx } from '../authz';
import { emailWithLetterhead, letterheadFor, loadLetterhead, loadLogo } from '../branding/letterhead';
import { loadEngagement } from '../engagements/service';
import {
  loadTaxes, manualDraftLine, manualLine, money, moneyField, presentTaxes, taxesJson, taxMode, totalsOf, uuid, type DraftLine,
} from './documents';
import { createEmailProvider, createTaxProvider, type TaxSubmission } from './providers';
import { canManageBilling, canSeeBilling } from './settings';
import { timeValue } from './time';

const METHODS = ['bank', 'mpesa', 'cash', 'cheque', 'other'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'not a real date');

const billingItems = z.object({
  timeEntryIds: z.array(uuid).max(500).default([]),
  expenseIds: z.array(uuid).max(200).default([]),
  flatFee: z.boolean().default(false),
});
const invoiceBody = z
  .object({
    clientId: uuid,
    engagementId: uuid.optional(),
    taxMode: taxMode.default('exclusive'),
    taxIds: z.array(uuid).max(5).default([]),
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(manualLine).max(100).default([]),
    billing: billingItems.optional(),
  })
  .refine((b) => b.lines.length > 0 || (b.billing && (b.billing.timeEntryIds.length > 0 || b.billing.expenseIds.length > 0 || b.billing.flatFee)), {
    message: 'an invoice needs at least one line', path: ['lines'],
  })
  .refine((b) => !b.billing || b.engagementId !== undefined, { message: 'billing time or expenses needs the engagement', path: ['engagementId'] });
type InvoiceBody = z.infer<typeof invoiceBody>;

/** Lines for an invoice: those typed in, plus time, expenses and the flat fee taken from the engagement. All must still be unbilled. */
async function buildLines(tx: PoolClient, b: InvoiceBody): Promise<DraftLine[]> {
  const lines: DraftLine[] = b.lines.map(manualDraftLine);
  if (!b.billing || !b.engagementId) return lines;
  const eng = b.engagementId;

  if (b.billing.timeEntryIds.length > 0) {
    const ids = [...new Set(b.billing.timeEntryIds)];
    const rows = (
      await tx.query(
        `select t.id, t.user_id, coalesce(u.full_name, u.email) as user_name, t.minutes, t.rate_cents::text as rate
           from time_entries t join users u on u.id = t.user_id
          where t.id = any($1::uuid[]) and t.engagement_id = $2 and t.billable and t.invoice_id is null`,
        [ids, eng],
      )
    ).rows as { id: string; user_id: string; user_name: string; minutes: number; rate: string }[];
    if (rows.length !== ids.length) throw httpError(422, 'unknown_time_entries');
    const groups = new Map<string, { name: string; rate: bigint; minutes: number; amount: bigint; ids: string[] }>();
    for (const r of rows) {
      const key = `${r.user_id}|${r.rate}`;
      const g = groups.get(key) ?? { name: r.user_name, rate: BigInt(r.rate), minutes: 0, amount: 0n, ids: [] };
      g.minutes += r.minutes;
      g.amount += timeValue(r.minutes, g.rate);
      g.ids.push(r.id);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      lines.push({
        description: `Professional time: ${g.name}`, quantity: (g.minutes / 60).toFixed(3), unitCents: g.rate, amountCents: g.amount, source: 'time', sourceIds: g.ids,
      });
    }
  }

  if (b.billing.expenseIds.length > 0) {
    const ids = [...new Set(b.billing.expenseIds)];
    const rows = (
      await tx.query(
        `select id, category, description, amount_cents::text as amount from engagement_expenses
          where id = any($1::uuid[]) and engagement_id = $2 and rebillable and invoice_id is null order by spent_on, created_at`,
        [ids, eng],
      )
    ).rows as { id: string; category: string; description: string; amount: string }[];
    if (rows.length !== ids.length) throw httpError(422, 'unknown_expenses');
    for (const r of rows) {
      lines.push({ description: `Expense (${r.category}): ${r.description}`, quantity: '1.000', unitCents: BigInt(r.amount), amountCents: BigInt(r.amount), source: 'expense', sourceIds: [r.id] });
    }
  }

  if (b.billing.flatFee) {
    const fee = (await tx.query("select flat_fee_cents::text as cents from engagement_fees where engagement_id = $1 and basis = 'flat'", [eng])).rows[0] as { cents: string } | undefined;
    if (!fee) throw httpError(422, 'no_flat_fee');
    lines.push({ description: 'Audit fee (fixed)', quantity: '1.000', unitCents: BigInt(fee.cents), amountCents: BigInt(fee.cents), source: 'fee', sourceIds: [] });
  }
  return lines;
}

async function saveDraft(tx: PoolClient, ctx: { tenantId: string; userId: string }, b: InvoiceBody, invoiceId?: string): Promise<string> {
  const client = (await tx.query('select id from clients where id = $1', [b.clientId])).rows[0];
  if (!client) throw httpError(404, 'not_found');
  if (b.engagementId) {
    const eng = await loadEngagement(tx, b.engagementId);
    if (!eng) throw httpError(404, 'not_found');
    if (eng.client_id !== b.clientId) throw httpError(400, 'engagement_client_mismatch');
  }
  const lines = await buildLines(tx, b);
  const taxes = await loadTaxes(tx, b.taxIds);
  const totals = totalsOf(lines, taxes, b.taxMode);
  let id = invoiceId;
  if (id) {
    await tx.query('delete from invoice_lines where invoice_id = $1', [id]);
    await tx.query(
      'update invoices set client_id = $2, engagement_id = $3, notes = $4, tax_mode = $5, taxes = $6::jsonb, subtotal_cents = $7, tax_cents = $8, total_cents = $9 where id = $1',
      [id, b.clientId, b.engagementId ?? null, b.notes ?? null, b.taxMode, taxesJson(totals), totals.subtotalCents.toString(), totals.taxCents.toString(), totals.totalCents.toString()],
    );
  } else {
    id = (
      await tx.query(
        `insert into invoices (tenant_id, client_id, engagement_id, notes, tax_mode, taxes, subtotal_cents, tax_cents, total_cents, created_by)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) returning id`,
        [ctx.tenantId, b.clientId, b.engagementId ?? null, b.notes ?? null, b.taxMode, taxesJson(totals), totals.subtotalCents.toString(), totals.taxCents.toString(), totals.totalCents.toString(), ctx.userId],
      )
    ).rows[0].id as string;
  }
  let position = 0;
  for (const l of lines) {
    await tx.query(
      'insert into invoice_lines (tenant_id, invoice_id, position, description, quantity, unit_cents, amount_cents, source, source_ids) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[])',
      [ctx.tenantId, id, position++, l.description, l.quantity, l.unitCents.toString(), l.amountCents.toString(), l.source, l.sourceIds],
    );
  }
  return id;
}

interface InvoiceRow {
  id: string; number: string | null; status: string; overdue: boolean; client_id: string; client_name: string; engagement_id: string | null; issue_date: string | null;
  due_date: string | null; notes: string | null; tax_mode: string; taxes: unknown; subtotal_cents: string; tax_cents: string; total_cents: string; paid_cents: string;
  etims: TaxSubmission | null; created_by_name: string; void_reason: string | null; letterhead: unknown;
}

const INVOICE_SQL = `select i.id, i.number, i.status,
       (i.status in ('sent', 'part_paid') and i.due_date < (now() at time zone 'Africa/Nairobi')::date) as overdue,
       i.client_id, c.name as client_name, i.engagement_id, to_char(i.issue_date, 'YYYY-MM-DD') as issue_date, to_char(i.due_date, 'YYYY-MM-DD') as due_date,
       i.notes, i.tax_mode, i.taxes, i.subtotal_cents::text, i.tax_cents::text, i.total_cents::text, i.paid_cents::text, i.etims,
       coalesce(u.full_name, u.email) as created_by_name, i.void_reason, i.letterhead
  from invoices i join clients c on c.id = i.client_id join users u on u.id = i.created_by`;

const presentInvoice = (r: InvoiceRow) => ({
  id: r.id, number: r.number, status: r.status, overdue: r.overdue, clientId: r.client_id, clientName: r.client_name, engagementId: r.engagement_id,
  issueDate: r.issue_date, dueDate: r.due_date, notes: r.notes, taxMode: r.tax_mode, taxes: presentTaxes(r.taxes),
  subtotal: money(r.subtotal_cents), taxTotal: money(r.tax_cents), total: money(r.total_cents), paid: money(r.paid_cents),
  outstanding: money(BigInt(r.total_cents) - BigInt(r.paid_cents)), createdBy: r.created_by_name, voidReason: r.void_reason,
  tax: r.etims ? { provider: r.etims.provider, simulated: r.etims.simulated, status: r.etims.status, controlNumber: r.etims.controlNumber ?? null, message: r.etims.message } : null,
});

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  const taxProvider = createTaxProvider(process.env);
  const emailProvider = createEmailProvider(process.env);

  const requireSee = (req: Parameters<typeof canSeeBilling>[0]) => {
    if (!canSeeBilling(req)) throw httpError(403, 'forbidden');
  };
  const requireManage = (req: Parameters<typeof canSeeBilling>[0]) => {
    if (!canManageBilling(req)) throw httpError(403, 'forbidden');
  };

  /** Hands an issued invoice to the tax-submission provider and records the outcome. A provider failure never undoes the invoice. */
  async function submitTax(ctx: { tenantId: string; userId: string; readOnly?: boolean }, id: string): Promise<TaxSubmission> {
    const inv = await withTenant(pool, ctx, async (tx) =>
      (await tx.query(`select i.number, i.total_cents::text as total, to_char(i.issue_date, 'YYYY-MM-DD') as issued, c.name as client_name from invoices i join clients c on c.id = i.client_id where i.id = $1`, [id])).rows[0] as
        | { number: string | null; total: string; issued: string; client_name: string }
        | undefined,
    );
    if (!inv?.number) throw httpError(404, 'not_found');
    let result: TaxSubmission;
    try {
      result = await taxProvider.submit({ id, tenantId: ctx.tenantId, number: inv.number, totalCents: BigInt(inv.total), issueDate: inv.issued, clientName: inv.client_name, clientPin: null });
    } catch (e) {
      req_log(app, e);
      result = { provider: taxProvider.name, simulated: false, status: 'failed', submittedAt: new Date().toISOString(), message: 'The tax submission failed. The invoice was issued; submit it again.' };
    }
    await withTenant(pool, ctx, (tx) => tx.query('select invoice_set_etims($1, $2::jsonb)', [id, JSON.stringify(result)]));
    return result;
  }

  app.get('/engagements/:id/billable', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const eng = await loadEngagement(tx, id.data);
      if (!eng) throw httpError(404, 'not_found');
      const time = (
        await tx.query(
          `select t.id, coalesce(u.full_name, u.email) as user_name, to_char(t.work_date, 'YYYY-MM-DD') as work_date, t.minutes, t.description, t.rate_cents::text as rate
             from time_entries t join users u on u.id = t.user_id
            where t.engagement_id = $1 and t.billable and t.invoice_id is null order by t.work_date, t.created_at`,
          [id.data],
        )
      ).rows;
      const expenses = (
        await tx.query(
          `select id, to_char(spent_on, 'YYYY-MM-DD') as spent_on, category, description, amount_cents::text as amount from engagement_expenses
            where engagement_id = $1 and rebillable and invoice_id is null order by spent_on`,
          [id.data],
        )
      ).rows;
      const fee = (await tx.query('select basis, flat_fee_cents::text as flat from engagement_fees where engagement_id = $1', [id.data])).rows[0];
      return {
        client: { id: eng.client_id, name: eng.client_name },
        time: time.map((t) => ({ id: t.id as string, userName: t.user_name as string, workDate: t.work_date as string, minutes: t.minutes as number, description: t.description as string, rate: money(t.rate), value: money(timeValue(t.minutes, BigInt(t.rate))) })),
        expenses: expenses.map((x) => ({ id: x.id as string, spentOn: x.spent_on as string, category: x.category as string, description: x.description as string, amount: money(x.amount) })),
        fee: fee ? { basis: fee.basis as string, flatFee: fee.flat === null ? null : money(fee.flat) } : null,
      };
    });
  });

  app.get('/invoices', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const q = z.object({ status: z.enum(['draft', 'sent', 'part_paid', 'paid', 'void', 'overdue', 'open']).optional(), clientId: uuid.optional() }).parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.clientId) { params.push(q.clientId); where.push(`i.client_id = $${params.length}`); }
    if (q.status === 'overdue') where.push("i.status in ('sent', 'part_paid') and i.due_date < (now() at time zone 'Africa/Nairobi')::date");
    else if (q.status === 'open') where.push("i.status in ('sent', 'part_paid')");
    else if (q.status) { params.push(q.status); where.push(`i.status = $${params.length}`); }
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (await tx.query(`${INVOICE_SQL} ${where.length ? `where ${where.join(' and ')}` : ''} order by coalesce(i.issued_at, i.created_at) desc`, params)).rows as InvoiceRow[],
    );
    return { invoices: rows.map(presentInvoice) };
  });

  app.get<{ Params: { id: string } }>('/invoices/:id', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const r = (await tx.query(`${INVOICE_SQL} where i.id = $1`, [id.data])).rows[0] as InvoiceRow | undefined;
      if (!r) throw httpError(404, 'not_found');
      const lines = (await tx.query('select description, quantity::text as quantity, unit_cents::text as unit, amount_cents::text as amount, source from invoice_lines where invoice_id = $1 order by position', [id.data])).rows;
      const payments = (await tx.query("select amount_cents::text as amount, to_char(paid_on, 'YYYY-MM-DD') as paid_on, method, reference from invoice_payments where invoice_id = $1 order by paid_on, created_at", [id.data])).rows;
      const lh = await letterheadFor(tx, r.letterhead, r.status);
      return {
        ...presentInvoice(r),
        letterhead: lh.letterhead, letterheadIsLive: lh.live,
        lines: lines.map((l) => ({ description: l.description as string, quantity: l.quantity as string, unitPrice: money(l.unit), amount: money(l.amount), source: l.source as string })),
        payments: payments.map((p) => ({ amount: money(p.amount), paidOn: p.paid_on as string, method: p.method as string, reference: p.reference as string | null })),
      };
    });
  });

  app.post('/invoices', { config: { access: 'tenant' } }, async (req, reply) => {
    requireSee(req);
    const b = invoiceBody.parse(req.body);
    const ctx = tenantCtx(req);
    const id = await withTenant(pool, ctx, (tx) => saveDraft(tx, ctx, b));
    return reply.code(201).send({ id });
  });

  app.put<{ Params: { id: string } }>('/invoices/:id', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = invoiceBody.parse(req.body);
    const ctx = tenantCtx(req);
    await withTenant(pool, ctx, async (tx) => {
      const cur = (await tx.query('select status from invoices where id = $1', [id.data])).rows[0] as { status: string } | undefined;
      if (!cur) throw httpError(404, 'not_found');
      if (cur.status !== 'draft') throw httpError(409, 'invoice_issued');
      await saveDraft(tx, ctx, b, id.data);
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/invoices/:id', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    await withTenant(pool, tenantCtx(req), async (tx) => {
      const cur = (await tx.query('select status from invoices where id = $1', [id.data])).rows[0] as { status: string } | undefined;
      if (!cur) throw httpError(404, 'not_found');
      if (cur.status !== 'draft') throw httpError(409, 'invoice_issued');
      const r = await tx.query('delete from invoices where id = $1', [id.data]);
      if (r.rowCount === 0) throw httpError(403, 'forbidden');
    });
    return { ok: true };
  });

  /** Issuing is a partner or administrator step: it numbers, locks and bills. Then the tax provider is asked to register it. */
  app.post<{ Params: { id: string } }>('/invoices/:id/issue', { config: { access: 'tenant' } }, async (req) => {
    requireManage(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const ctx = tenantCtx(req);
    const issued = await withTenant(pool, ctx, async (tx) => {
      const s = (await tx.query('select invoice_prefix, payment_terms_days from billing_settings')).rows[0] as { invoice_prefix: string; payment_terms_days: number } | undefined;
      const r = (await tx.query('select number, to_char(issue_date, \'YYYY-MM-DD\') as issue_date, to_char(due_date, \'YYYY-MM-DD\') as due_date from invoice_issue($1, $2, $3)', [id.data, s?.invoice_prefix ?? 'INV', s?.payment_terms_days ?? 30])).rows[0];
      // The letterhead is copied onto the invoice in the same transaction as the issue, so no issued invoice is left without one.
      await tx.query('select invoice_set_letterhead($1, $2::jsonb)', [id.data, JSON.stringify(await loadLetterhead(tx))]);
      return r as { number: string; issue_date: string; due_date: string };
    });
    const tax = await submitTax(ctx, id.data);
    return { number: issued.number, issueDate: issued.issue_date, dueDate: issued.due_date, tax };
  });

  app.post<{ Params: { id: string } }>('/invoices/:id/submit', { config: { access: 'tenant' } }, async (req) => {
    requireManage(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const ctx = tenantCtx(req);
    const st = await withTenant(pool, ctx, async (tx) => (await tx.query('select status, etims from invoices where id = $1', [id.data])).rows[0] as { status: string; etims: TaxSubmission | null } | undefined);
    if (!st) throw httpError(404, 'not_found');
    if (st.status === 'draft' || st.status === 'void') throw httpError(409, 'invoice_not_issued');
    return { tax: await submitTax(ctx, id.data) };
  });

  app.post<{ Params: { id: string } }>('/invoices/:id/payments', { config: { access: 'tenant' } }, async (req) => {
    requireManage(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = z.object({ amount: moneyField(false), paidOn: day, method: z.enum(METHODS), reference: z.string().trim().max(100).optional() }).parse(req.body);
    await withTenant(pool, tenantCtx(req), (tx) => tx.query('select invoice_record_payment($1, $2, $3, $4, $5)', [id.data, b.amount.toString(), b.paidOn, b.method, b.reference ?? null]));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/invoices/:id/void', { config: { access: 'tenant' } }, async (req) => {
    requireManage(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
    await withTenant(pool, tenantCtx(req), (tx) => tx.query('select invoice_void($1, $2)', [id.data, b.reason]));
    return { ok: true };
  });

  /** "Sends" the invoice. With the simulated email provider nothing leaves the system: the message is kept in the outbox, which says so. */
  app.post<{ Params: { id: string } }>('/invoices/:id/send', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = z.object({ to: z.string().trim().email().max(254), message: z.string().trim().max(2000).optional() }).parse(req.body);
    const ctx = tenantCtx(req);
    const result = await withTenant(pool, ctx, async (tx) => {
      const r = (await tx.query(`${INVOICE_SQL} where i.id = $1`, [id.data])).rows[0] as InvoiceRow | undefined;
      if (!r) throw httpError(404, 'not_found');
      if (r.status === 'draft' || r.status === 'void' || !r.number) throw httpError(409, 'invoice_not_issued');
      const { letterhead } = await letterheadFor(tx, r.letterhead, r.status);
      const firm = letterhead.name === 'Audit firm' ? 'Your auditors' : letterhead.name;
      const subject = `Invoice ${r.number} from ${firm}`;
      const message = [b.message ?? `Please find invoice ${r.number} for ${r.client_name}.`, '', `Amount due: KES ${money(BigInt(r.total_cents) - BigInt(r.paid_cents))}`, `Due date: ${r.due_date ?? ''}`, '', 'Practice mode: this message was kept in Sent emails and not actually sent.'].join('\n');
      const body = emailWithLetterhead(letterhead, message);
      const sent = await emailProvider.send({ to: b.to, subject, body });
      const outboxId = (
        await tx.query('insert into outbox (tenant_id, kind, ref_id, to_address, subject, body, provider, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id', [ctx.tenantId, 'invoice', id.data, b.to, subject, body, sent.provider, ctx.userId])
      ).rows[0].id as string;
      return { outboxId, provider: sent.provider, delivered: sent.delivered };
    });
    return result;
  });

  app.get<{ Params: { id: string } }>('/invoices/:id/pdf', { config: { access: 'tenant' } }, async (req, reply) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const { inv, lines, letterhead } = await withTenant(pool, tenantCtx(req), async (tx) => {
      const r = (await tx.query(`${INVOICE_SQL} where i.id = $1`, [id.data])).rows[0] as InvoiceRow | undefined;
      if (!r) throw httpError(404, 'not_found');
      return {
        inv: r,
        lines: (await tx.query('select description, quantity::text as quantity, unit_cents::text as unit, amount_cents::text as amount from invoice_lines where invoice_id = $1 order by position', [id.data])).rows,
        letterhead: await (async () => {
          const lh = (await letterheadFor(tx, r.letterhead, r.status)).letterhead;
          return { ...lh, logo: await loadLogo(tx, lh.logoId) };
        })(),
      };
    });
    const p = presentInvoice(inv);
    const pdf = await exportBillingPdf({
      kind: 'invoice', number: inv.number, status: inv.status,
      letterhead,
      clientName: inv.client_name, date: inv.issue_date, dueOrValidUntil: inv.due_date,
      lines: lines.map((l) => ({ description: l.description as string, quantity: Number(l.quantity).toFixed(2), unit: money(l.unit), amount: money(l.amount) })),
      subtotal: p.subtotal, taxMode: inv.tax_mode as 'exclusive' | 'inclusive', taxes: p.taxes.map((t) => ({ name: t.name, rate: t.rate, amount: t.amount })), total: p.total,
      ...(inv.number ? { paid: p.paid, outstanding: p.outstanding } : {}), notes: inv.notes,
      simulatedTax: inv.etims?.simulated ? { controlNumber: inv.etims.controlNumber ?? null, message: inv.etims.message } : null,
    });
    const name = (inv.number ?? 'draft-invoice').replace(/[^A-Za-z0-9-]/g, '_');
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${name}.pdf"`).send(pdf);
  });

  app.get('/outbox', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (await tx.query('select o.id, o.kind, o.ref_id, o.to_address, o.subject, o.body, o.provider, o.created_at, coalesce(u.full_name, u.email) as by from outbox o join users u on u.id = o.created_by order by o.created_at desc limit 100')).rows,
    );
    return {
      messages: rows.map((r) => ({ id: r.id as string, kind: r.kind as string, refId: r.ref_id as string, to: r.to_address as string, subject: r.subject as string, body: r.body as string, provider: r.provider as string, sentBy: r.by as string, at: r.created_at as string, delivered: false })),
    };
  });

}

function req_log(app: FastifyInstance, e: unknown): void {
  app.log.error({ err: e }, 'tax submission failed');
}
