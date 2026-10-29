import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { exportBillingPdf } from '@auditos/exports';
import { withTenant } from '@auditos/db';
import { actorOf, httpError, tenantCtx } from '../authz';
import { loadEngagement } from '../engagements/service';
import { loadTaxes, manualDraftLine, manualLine, money, presentTaxes, taxesJson, taxMode, totalsOf, uuid } from './documents';
import { createEmailProvider } from './providers';
import { canSeeBilling } from './settings';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'not a real date');

const quoteBody = z
  .object({
    clientId: uuid.optional(),
    prospectId: uuid.optional(),
    title: z.string().trim().min(1).max(200),
    validUntil: day.optional(),
    notes: z.string().trim().max(2000).optional(),
    taxMode: taxMode.default('exclusive'),
    taxIds: z.array(uuid).max(5).default([]),
    lines: z.array(manualLine).min(1).max(100),
  })
  .refine((b) => (b.clientId === undefined) !== (b.prospectId === undefined), { message: 'a quotation is for a client or a prospect, not both or neither', path: ['clientId'] });
type QuoteBody = z.infer<typeof quoteBody>;

interface QuoteRow {
  id: string; number: string | null; status: string; client_id: string | null; prospect_id: string | null; subject_name: string | null; title: string;
  valid_until: string | null; notes: string | null; tax_mode: string; taxes: unknown; subtotal_cents: string; tax_cents: string; total_cents: string;
  created_by_name: string; sent_at: string | null;
}

const QUOTE_SQL = `select q.id, q.number, q.status, q.client_id, q.prospect_id, coalesce(c.name, p.name) as subject_name, q.title,
       to_char(q.valid_until, 'YYYY-MM-DD') as valid_until, q.notes, q.tax_mode, q.taxes, q.subtotal_cents::text, q.tax_cents::text, q.total_cents::text,
       coalesce(u.full_name, u.email) as created_by_name, q.sent_at
  from quotes q left join clients c on c.id = q.client_id left join prospects p on p.id = q.prospect_id join users u on u.id = q.created_by`;

const presentQuote = (r: QuoteRow) => ({
  id: r.id, number: r.number, status: r.status, clientId: r.client_id, prospectId: r.prospect_id, subjectName: r.subject_name ?? 'Prospect', title: r.title,
  validUntil: r.valid_until, notes: r.notes, taxMode: r.tax_mode, taxes: presentTaxes(r.taxes), subtotal: money(r.subtotal_cents), taxTotal: money(r.tax_cents),
  total: money(r.total_cents), createdBy: r.created_by_name, sentAt: r.sent_at,
});

async function save(tx: PoolClient, ctx: { tenantId: string; userId: string }, b: QuoteBody, quoteId?: string): Promise<string> {
  if (b.clientId && !(await tx.query('select 1 from clients where id = $1', [b.clientId])).rows[0]) throw httpError(404, 'not_found');
  if (b.prospectId && !(await tx.query('select 1 from prospects where id = $1', [b.prospectId])).rows[0]) throw httpError(404, 'not_found');
  const lines = b.lines.map(manualDraftLine);
  const taxes = await loadTaxes(tx, b.taxIds);
  const totals = totalsOf(lines, taxes, b.taxMode);
  let id = quoteId;
  if (id) {
    await tx.query('delete from quote_lines where quote_id = $1', [id]);
    await tx.query(
      'update quotes set client_id = $2, prospect_id = $3, title = $4, valid_until = $5, notes = $6, tax_mode = $7, taxes = $8::jsonb, subtotal_cents = $9, tax_cents = $10, total_cents = $11 where id = $1',
      [id, b.clientId ?? null, b.prospectId ?? null, b.title, b.validUntil ?? null, b.notes ?? null, b.taxMode, taxesJson(totals), totals.subtotalCents.toString(), totals.taxCents.toString(), totals.totalCents.toString()],
    );
  } else {
    id = (
      await tx.query(
        `insert into quotes (tenant_id, client_id, prospect_id, title, valid_until, notes, tax_mode, taxes, subtotal_cents, tax_cents, total_cents, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12) returning id`,
        [ctx.tenantId, b.clientId ?? null, b.prospectId ?? null, b.title, b.validUntil ?? null, b.notes ?? null, b.taxMode, taxesJson(totals), totals.subtotalCents.toString(), totals.taxCents.toString(), totals.totalCents.toString(), ctx.userId],
      )
    ).rows[0].id as string;
  }
  let position = 0;
  for (const l of lines) {
    await tx.query('insert into quote_lines (tenant_id, quote_id, position, description, quantity, unit_cents, amount_cents) values ($1, $2, $3, $4, $5, $6, $7)', [
      ctx.tenantId, id, position++, l.description, l.quantity, l.unitCents.toString(), l.amountCents.toString(),
    ]);
  }
  return id;
}

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  const emailProvider = createEmailProvider(process.env);
  const requireSee = (req: Parameters<typeof canSeeBilling>[0]) => {
    if (!canSeeBilling(req)) throw httpError(403, 'forbidden');
  };

  app.get('/quotes', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const q = z.object({ status: z.enum(['draft', 'sent', 'accepted', 'declined']).optional() }).parse(req.query);
    const rows = await withTenant(pool, tenantCtx(req), async (tx) =>
      (await tx.query(`${QUOTE_SQL} ${q.status ? 'where q.status = $1' : ''} order by coalesce(q.sent_at, q.created_at) desc`, q.status ? [q.status] : [])).rows as QuoteRow[],
    );
    return { quotes: rows.map(presentQuote) };
  });

  app.get<{ Params: { id: string } }>('/quotes/:id', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const r = (await tx.query(`${QUOTE_SQL} where q.id = $1`, [id.data])).rows[0] as QuoteRow | undefined;
      if (!r) throw httpError(404, 'not_found');
      const lines = (await tx.query('select description, quantity::text as quantity, unit_cents::text as unit, amount_cents::text as amount from quote_lines where quote_id = $1 order by position', [id.data])).rows;
      return { ...presentQuote(r), lines: lines.map((l) => ({ description: l.description as string, quantity: l.quantity as string, unitPrice: money(l.unit), amount: money(l.amount) })) };
    });
  });

  app.post('/quotes', { config: { access: 'tenant' } }, async (req, reply) => {
    requireSee(req);
    const b = quoteBody.parse(req.body);
    const ctx = tenantCtx(req);
    const id = await withTenant(pool, ctx, (tx) => save(tx, ctx, b));
    return reply.code(201).send({ id });
  });

  app.put<{ Params: { id: string } }>('/quotes/:id', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = quoteBody.parse(req.body);
    const ctx = tenantCtx(req);
    await withTenant(pool, ctx, async (tx) => {
      const cur = (await tx.query('select status from quotes where id = $1', [id.data])).rows[0] as { status: string } | undefined;
      if (!cur) throw httpError(404, 'not_found');
      if (cur.status !== 'draft') throw httpError(409, 'quote_sent');
      await save(tx, ctx, b, id.data);
    });
    return { ok: true };
  });

  /** Sending numbers the quotation and freezes it. Given an address, a message is also left in the (simulated) outbox. */
  app.post<{ Params: { id: string } }>('/quotes/:id/send', { config: { access: 'tenant' } }, async (req) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = z.object({ to: z.string().trim().email().max(254).optional(), message: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    const ctx = tenantCtx(req);
    return withTenant(pool, ctx, async (tx) => {
      const s = (await tx.query('select quote_prefix, legal_name from billing_settings')).rows[0] as { quote_prefix: string; legal_name: string | null } | undefined;
      const number = (await tx.query('select quote_send($1, $2) as n', [id.data, s?.quote_prefix ?? 'QUO'])).rows[0].n as string;
      let outboxId: string | null = null;
      if (b.to) {
        const q = (await tx.query(`${QUOTE_SQL} where q.id = $1`, [id.data])).rows[0] as QuoteRow;
        const subject = `Quotation ${number} from ${s?.legal_name ?? 'Your auditors'}`;
        const body = [b.message ?? `Please find our quotation ${number}: ${q.title}.`, '', `Total: KES ${money(q.total_cents)}`, q.valid_until ? `Valid until: ${q.valid_until}` : '', '', 'Practice mode: this message was kept in Sent emails and not actually sent.'].join('\n');
        const sent = await emailProvider.send({ to: b.to, subject, body });
        outboxId = (
          await tx.query('insert into outbox (tenant_id, kind, ref_id, to_address, subject, body, provider, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id', [ctx.tenantId, 'quote', id.data, b.to, subject, body, sent.provider, ctx.userId])
        ).rows[0].id as string;
      }
      return { number, outboxId };
    });
  });

  for (const decision of ['accept', 'decline'] as const) {
    app.post<{ Params: { id: string } }>(`/quotes/:id/${decision}`, { config: { access: 'tenant' } }, async (req) => {
      requireSee(req);
      const id = uuid.safeParse(req.params.id);
      if (!id.success) throw httpError(404, 'not_found');
      await withTenant(pool, tenantCtx(req), (tx) => tx.query('select quote_decide($1, $2)', [id.data, decision === 'accept' ? 'accepted' : 'declined']));
      return { ok: true };
    });
  }

  /** An accepted quotation becomes the flat fee of an engagement of that client. */
  app.post<{ Params: { id: string } }>('/quotes/:id/apply-fee', { config: { access: 'tenant' } }, async (req) => {
    const a = actorOf(req);
    if (a.role !== 'manager' && a.role !== 'partner') throw httpError(403, 'forbidden');
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = z.object({ engagementId: uuid }).parse(req.body);
    const ctx = tenantCtx(req);
    await withTenant(pool, ctx, async (tx) => {
      const q = (await tx.query('select status, client_id, subtotal_cents::text as subtotal from quotes where id = $1', [id.data])).rows[0] as { status: string; client_id: string | null; subtotal: string } | undefined;
      if (!q) throw httpError(404, 'not_found');
      const eng = await loadEngagement(tx, b.engagementId);
      if (!eng) throw httpError(404, 'not_found');
      if (q.status !== 'accepted') throw httpError(409, 'quote_not_accepted');
      if (q.client_id && q.client_id !== eng.client_id) throw httpError(400, 'engagement_client_mismatch');
      await tx.query(
        `insert into engagement_fees (engagement_id, tenant_id, basis, flat_fee_cents) values ($1, $2, 'flat', $3)
         on conflict (engagement_id) do update set basis = 'flat', flat_fee_cents = excluded.flat_fee_cents, updated_at = now()`,
        [b.engagementId, ctx.tenantId, q.subtotal],
      );
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/quotes/:id/pdf', { config: { access: 'tenant' } }, async (req, reply) => {
    requireSee(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const { r, lines, settings } = await withTenant(pool, tenantCtx(req), async (tx) => {
      const row = (await tx.query(`${QUOTE_SQL} where q.id = $1`, [id.data])).rows[0] as QuoteRow | undefined;
      if (!row) throw httpError(404, 'not_found');
      return {
        r: row,
        lines: (await tx.query('select description, quantity::text as quantity, unit_cents::text as unit, amount_cents::text as amount from quote_lines where quote_id = $1 order by position', [id.data])).rows,
        settings: (await tx.query('select legal_name, address, kra_pin, bank_details from billing_settings')).rows[0] as { legal_name: string | null; address: string | null; kra_pin: string | null; bank_details: string | null } | undefined,
      };
    });
    const p = presentQuote(r);
    const pdf = await exportBillingPdf({
      kind: 'quote', number: r.number, status: r.status,
      issuer: { legalName: settings?.legal_name ?? null, address: settings?.address ?? null, kraPin: settings?.kra_pin ?? null, bankDetails: null },
      clientName: p.subjectName, date: r.sent_at ? new Date(r.sent_at).toISOString().slice(0, 10) : null, dueOrValidUntil: r.valid_until,
      lines: lines.map((l) => ({ description: l.description as string, quantity: Number(l.quantity).toFixed(2), unit: money(l.unit), amount: money(l.amount) })),
      subtotal: p.subtotal, taxMode: r.tax_mode as 'exclusive' | 'inclusive', taxes: p.taxes.map((t) => ({ name: t.name, rate: t.rate, amount: t.amount })), total: p.total, notes: r.notes,
    });
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${(r.number ?? 'draft-quotation').replace(/[^A-Za-z0-9-]/g, '_')}.pdf"`).send(pdf);
  });
}
