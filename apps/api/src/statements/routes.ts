import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { analyse, checkIntegrity, readStatement, StatementError, type ParsedStatement, type ReadInput, type Txn } from '@auditos/bank-statements';
import { appendEvent } from '@auditos/audit-log';
import { withTenant } from '@auditos/db';
import { formatMoney, parseMoney } from '@auditos/fs-engine';
import { assertCan, httpError, tenantCtx } from '../authz';
import { recordView } from '../audit/views';
import { loadEngagement } from '../engagements/service';
import { bigintJson } from '../financials/service';
import { decrypt, encrypt } from '../security/crypto';

const uuid = z.string().uuid();
const confirmBody = z.object({ reason: z.string().trim().min(5).max(500).optional() });
const analysisQuery = z.object({
  ledger: z.string().trim().max(30).optional(),
  parties: z.string().trim().max(1000).optional(),
});
const pageQuery = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(200) });

const ERROR_STATUS: Record<string, number> = { not_a_pdf: 415, unreadable_file: 415 };

/** What is kept, encrypted: the entries and what could not be read. The account number is never in it. */
interface Stored {
  transactions: { date: string; description: string; amountCents: string; balanceCents: string | null; reference?: string }[];
  issues: { code: string; message: string; line?: string }[];
  columns: Record<string, string>;
}

const pack = (p: ParsedStatement): string =>
  encrypt(JSON.stringify({
    transactions: p.transactions.map((t) => ({ date: t.date, description: t.description, amountCents: t.amountCents.toString(), balanceCents: t.balanceCents === null ? null : t.balanceCents.toString(), ...(t.reference ? { reference: t.reference } : {}) })),
    // The raw line of an unreadable row can carry account details; it is kept short and only inside the encrypted blob.
    issues: p.issues.map((i) => ({ code: i.code, message: i.message, ...(i.line ? { line: i.line.slice(0, 200) } : {}) })),
    columns: p.columns,
  } satisfies Stored));

const unpack = (blob: string): Stored => JSON.parse(decrypt(blob)) as Stored;

const txnsOf = (s: Stored): Txn[] =>
  s.transactions.map((t) => ({ date: t.date, description: t.description, amountCents: BigInt(t.amountCents), balanceCents: t.balanceCents === null ? null : BigInt(t.balanceCents), ...(t.reference ? { reference: t.reference } : {}) }));

const money = (c: bigint | null): string | null => (c === null ? null : formatMoney(c));
const cents = (s: string | null | undefined): bigint | null => (s === null || s === undefined ? null : BigInt(s));

interface Row {
  id: string; engagement_id: string; filename: string; source: 'pdf' | 'csv' | 'xlsx'; bank_name: string | null; account_last4: string | null;
  period_from: string | null; period_to: string | null; opening_cents: string | null; closing_cents: string | null; txn_count: number;
  integrity_status: 'verified' | 'broken' | 'unverified'; integrity_messages: string[]; content_enc: string;
  confirmed_at: Date | null; acknowledged_reason: string | null; created_at: Date; uploaded_by_name: string | null; confirmed_by_name: string | null;
}

const SELECT = `select s.id, s.engagement_id, s.filename, s.source, s.bank_name, s.account_last4,
       to_char(s.period_from, 'YYYY-MM-DD') as period_from, to_char(s.period_to, 'YYYY-MM-DD') as period_to,
       s.opening_cents::text, s.closing_cents::text, s.txn_count, s.integrity_status, s.integrity_messages, s.content_enc,
       s.confirmed_at, s.acknowledged_reason, s.created_at, u.full_name as uploaded_by_name, c.full_name as confirmed_by_name
  from bank_statements s join users u on u.id = s.uploaded_by left join users c on c.id = s.confirmed_by`;

const summary = (r: Row) => ({
  id: r.id, filename: r.filename, source: r.source, bankName: r.bank_name, accountLast4: r.account_last4,
  periodFrom: r.period_from, periodTo: r.period_to, opening: money(cents(r.opening_cents)), closing: money(cents(r.closing_cents)),
  transactionCount: r.txn_count, integrity: { status: r.integrity_status, messages: r.integrity_messages },
  confirmed: r.confirmed_at !== null, confirmedAt: r.confirmed_at, confirmedBy: r.confirmed_by_name, acknowledgedReason: r.acknowledged_reason,
  uploadedBy: r.uploaded_by_name, uploadedAt: r.created_at,
});

const kindOf = (name: string): ReadInput['kind'] | null => {
  const n = name.toLowerCase();
  return n.endsWith('.pdf') ? 'pdf' : n.endsWith('.csv') ? 'csv' : n.endsWith('.xlsx') ? 'xlsx' : null;
};

const safeName = (name: string): string => name.replace(/[^\w .()\-]/g, '_').slice(-200) || 'statement';

export async function statementRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  const id = (v: string) => {
    const p = uuid.safeParse(v);
    if (!p.success) throw httpError(404, 'not_found');
    return p.data;
  };

  /** Reads the file and keeps it as an unconfirmed statement. The password, if the PDF needed one, is used once and dropped. */
  app.post<{ Params: { id: string } }>('/engagements/:id/bank-statements', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = id(req.params.id);
    if (!req.isMultipart()) throw httpError(415, 'multipart_required');
    const ctx = tenantCtx(req);
    const eng = await withTenant(pool, ctx, (tx) => loadEngagement(tx, engagementId));
    if (!eng) throw httpError(404, 'not_found');
    assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });

    const file = await req.file();
    if (!file) throw httpError(400, 'file_required');
    const kind = kindOf(file.filename);
    if (!kind) return reply.code(415).send({ error: 'unsupported_type', message: 'Upload a PDF, CSV or Excel (.xlsx) statement.' });
    const data = await file.toBuffer();
    const password = (file.fields.password as { value?: string } | undefined)?.value || undefined;

    let parsed: ParsedStatement;
    try {
      const input: ReadInput = kind === 'pdf'
        ? { kind, data: new Uint8Array(data), ...(password ? { password } : {}) }
        : kind === 'csv' ? { kind, text: data.toString('utf8') } : { kind, data: new Uint8Array(data) };
      parsed = await readStatement(input);
    } catch (e) {
      if (e instanceof StatementError) return reply.code(ERROR_STATUS[e.code] ?? 422).send({ error: e.code, message: e.message });
      throw e;
    }

    const integrity = checkIntegrity(parsed);
    const messages = [...integrity.messages, ...parsed.issues.filter((i) => !['unreadable_row', 'direction_unknown', 'both_columns'].includes(i.code)).map((i) => i.message)];
    const row = await withTenant(pool, ctx, async (tx) => {
      const r = await tx.query(
        `insert into bank_statements (tenant_id, engagement_id, filename, source, bank_name, account_last4, period_from, period_to, opening_cents, closing_cents,
                                      txn_count, integrity_status, integrity_messages, content_enc)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14) returning id`,
        [ctx.tenantId, engagementId, safeName(file.filename), parsed.source, parsed.bankName, parsed.accountLast4, parsed.periodFrom, parsed.periodTo,
          parsed.openingCents?.toString() ?? null, parsed.closingCents?.toString() ?? null, parsed.transactions.length, integrity.status, JSON.stringify(messages), pack(parsed)],
      );
      const sid = r.rows[0].id as string;
      await appendEvent(tx, { action: 'evidence.statement_uploaded', entityType: 'bank_statement', entityId: sid,
        detail: { label: safeName(file.filename), engagementId, clientName: eng.client_name, status: integrity.status } });
      return sid;
    });

    const unreadable = parsed.issues.filter((i) => ['unreadable_row', 'direction_unknown', 'both_columns'].includes(i.code));
    return reply.code(201).send({
      id: row, source: parsed.source, bankName: parsed.bankName, accountLast4: parsed.accountLast4, periodFrom: parsed.periodFrom, periodTo: parsed.periodTo,
      opening: money(parsed.openingCents), closing: money(parsed.closingCents), transactionCount: parsed.transactions.length,
      integrity: { status: integrity.status, messages, computedClosing: money(integrity.computedClosingCents), difference: money(integrity.differenceCents), balanceBreaks: integrity.balanceBreaks.slice(0, 20).map((b) => ({ index: b.index, date: b.date, description: b.description, expected: formatMoney(b.expectedCents), printed: formatMoney(b.printedCents) })) },
      totals: { in: formatMoney(integrity.totals.inCents), out: formatMoney(integrity.totals.outCents) },
      unreadable: unreadable.slice(0, 20).map((i) => ({ message: i.message, line: i.line ?? null })),
      preview: parsed.transactions.slice(0, 10).map((t) => ({ date: t.date, description: t.description, amount: formatMoney(t.amountCents), balance: money(t.balanceCents) })),
    });
  });

  app.get<{ Params: { id: string } }>('/engagements/:id/bank-statements', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = id(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId))) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const rows = (await tx.query(`${SELECT} where s.engagement_id = $1 order by s.created_at desc`, [engagementId])).rows as Row[];
      return { statements: rows.map(summary) };
    });
  });

  /** Says the statement was read completely. One that does not add up needs a reason, which stays on the record. */
  app.post<{ Params: { id: string; sid: string } }>('/engagements/:id/bank-statements/:sid/confirm', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = id(req.params.id);
    const sid = id(req.params.sid);
    const body = confirmBody.parse(req.body ?? {});
    const ctx = tenantCtx(req);
    return withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      const cur = (await tx.query('select integrity_status, confirmed_at, filename from bank_statements where id = $1 and engagement_id = $2', [sid, engagementId])).rows[0] as
        { integrity_status: string; confirmed_at: Date | null; filename: string } | undefined;
      if (!cur) throw httpError(404, 'not_found');
      if (cur.confirmed_at) throw httpError(409, 'statement_confirmed');
      if (cur.integrity_status !== 'verified' && !body.reason) throw httpError(422, 'acknowledgement_required');
      await tx.query('update bank_statements set acknowledged_reason = $2 where id = $1', [sid, cur.integrity_status === 'verified' ? null : body.reason ?? null]);
      await appendEvent(tx, { action: 'evidence.statement_confirmed', entityType: 'bank_statement', entityId: sid,
        detail: { label: cur.filename, engagementId, clientName: eng.client_name, status: cur.integrity_status, ...(cur.integrity_status !== 'verified' ? { reason: body.reason } : {}) } });
      return { confirmed: true };
    });
  });

  /** Only a statement nobody has confirmed can be thrown away (for example, one that was read wrongly). */
  app.delete<{ Params: { id: string; sid: string } }>('/engagements/:id/bank-statements/:sid', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = id(req.params.id);
    const sid = id(req.params.sid);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      const cur = (await tx.query('select confirmed_at, filename from bank_statements where id = $1 and engagement_id = $2', [sid, engagementId])).rows[0] as { confirmed_at: Date | null; filename: string } | undefined;
      if (!cur) throw httpError(404, 'not_found');
      if (cur.confirmed_at) throw httpError(409, 'statement_confirmed');
      await tx.query('delete from bank_statements where id = $1', [sid]);
      await appendEvent(tx, { action: 'evidence.statement_discarded', entityType: 'bank_statement', entityId: sid, detail: { label: cur.filename, engagementId, clientName: eng.client_name } });
      return reply.code(204).send();
    });
  });

  /** The entries, a page at a time. Opening them is logged. */
  app.get<{ Params: { id: string; sid: string }; Querystring: { offset?: string; limit?: string } }>('/engagements/:id/bank-statements/:sid', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = id(req.params.id);
    const sid = id(req.params.sid);
    const page = pageQuery.parse(req.query);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const row = (await tx.query(`${SELECT} where s.id = $1 and s.engagement_id = $2`, [sid, engagementId])).rows[0] as Row | undefined;
      if (!row) throw httpError(404, 'not_found');
      await recordView(req, tx, { type: 'statement', id: sid, label: row.filename, clientName: eng.client_name, engagementId });
      const stored = unpack(row.content_enc);
      return {
        ...summary(row),
        unreadable: stored.issues.filter((i) => ['unreadable_row', 'direction_unknown', 'both_columns'].includes(i.code)).slice(0, 50),
        offset: page.offset,
        transactions: txnsOf(stored).slice(page.offset, page.offset + page.limit).map((t, i) => ({ index: page.offset + i, date: t.date, description: t.description, reference: t.reference ?? null, amount: formatMoney(t.amountCents), balance: money(t.balanceCents) })),
      };
    });
  });

  /** Observations to follow up. Only for a statement someone has confirmed was read completely. */
  app.get<{ Params: { id: string; sid: string } }>('/engagements/:id/bank-statements/:sid/analysis', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = id(req.params.id);
    const sid = id(req.params.sid);
    const q = analysisQuery.parse(req.query);
    let ledger: bigint | null = null;
    if (q.ledger) {
      try { ledger = parseMoney(q.ledger.replace(/[,\s]/g, '').replace(/^(KES|KSH)/i, '')); } catch { throw httpError(422, 'invalid_ledger_amount'); }
    }
    const parties = (q.parties ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const row = (await tx.query(`${SELECT} where s.id = $1 and s.engagement_id = $2`, [sid, engagementId])).rows[0] as Row | undefined;
      if (!row) throw httpError(404, 'not_found');
      if (!row.confirmed_at) throw httpError(409, 'not_confirmed');
      await recordView(req, tx, { type: 'statement', id: sid, label: row.filename, clientName: eng.client_name, engagementId });
      const stored = unpack(row.content_enc);
      const p: ParsedStatement = {
        source: row.source, bankName: row.bank_name, accountLast4: row.account_last4, periodFrom: row.period_from, periodTo: row.period_to,
        openingCents: cents(row.opening_cents), closingCents: cents(row.closing_cents), transactions: txnsOf(stored), columns: stored.columns, dateOrder: 'dmy', issues: [],
      };
      const a = analyse(p, { relatedParties: parties, ...(ledger !== null ? { ledgerBankCents: ledger } : {}) });
      const pretty = (c: bigint) => formatMoney(c);
      const rowOf = (index: number) => { const t = p.transactions[index]!; return { index, date: t.date, description: t.description, amount: pretty(t.amountCents) }; };
      return JSON.parse(bigintJson({
        statement: summary(row),
        monthly: a.monthly.map((m) => ({ month: m.month, count: m.count, in: pretty(m.inCents), out: pretty(m.outCents), closing: money(m.closingCents) })),
        largestIn: a.largestIn.map((l) => rowOf(l.index)),
        largestOut: a.largestOut.map((l) => rowOf(l.index)),
        cash: { in: pretty(a.cash.inCents), out: pretty(a.cash.outCents), count: a.cash.count },
        mobileMoney: { in: pretty(a.mobileMoney.inCents), out: pretty(a.mobileMoney.outCents), count: a.mobileMoney.count },
        flags: a.flags.map((f) => ({ code: f.code, severity: f.severity, message: f.message, feeds: f.feeds, rows: f.indexes.slice(0, 20).map(rowOf), rowCount: f.indexes.length })),
        reconciliation: a.reconciliation && { statementClosing: money(a.reconciliation.statementClosingCents), ledger: pretty(a.reconciliation.ledgerCents), difference: money(a.reconciliation.differenceCents), status: a.reconciliation.status },
      }));
    });
  });
}
