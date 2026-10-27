import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendEvent } from '@auditos/audit-log';
import { withTenant } from '@auditos/db';
import { exportDocx, exportPdf, exportXlsx, type ExportMeta } from '@auditos/exports';
import { formatMoney, mapTrialBalance, parseMoney, suggestMapping, TAXONOMY, UnsupportedFrameworkError } from '@auditos/fs-engine';
import { assertCan, httpError, tenantCtx } from '../authz';
import { recordView } from '../audit/views';
import { registerGate } from '../engagements/gates';
import { loadEngagement } from '../engagements/service';
import { parseTbUpload } from './parse';
import {
  applyAdjustments, bigintJson, computeStatements, entriesOf, fromTbLines, loadFinancials, mappingOf, tbOf, toTbLines,
  unadjustedTotal, upsertSingleton, type AdjustmentEntry, type Financials,
} from './service';

const uuid = z.string().uuid();
const LINE_IDS = new Set(TAXONOMY.map((l) => l.id));
const APPROVED = new Set(['partner_approved', 'report_issued', 'locked']);

const mappingBody = z.object({ mapping: z.record(z.string().min(1).max(30), z.string().max(60)) });
const adjustmentBody = z.object({
  description: z.string().trim().min(1).max(300),
  status: z.enum(['proposed', 'agreed', 'unadjusted']),
  lines: z.array(z.object({ code: z.string().min(1).max(30), debit: z.string().max(30).default('0.00'), credit: z.string().max(30).default('0.00') })).min(2).max(50),
});
const statusBody = z.object({ status: z.enum(['proposed', 'agreed', 'unadjusted']) });
const noteBody = z.object({ noteId: z.string().regex(/^[a-z0-9-]{1,60}$/), title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(20000) });
const exportBody = z.object({ format: z.enum(['docx', 'xlsx', 'pdf']) });

const TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export function registerFinancialGates(): void {
  registerGate('fieldwork', 'completion', {
    gate: 'trialBalanceMappedAndBalanced',
    message: 'A trial balance must be imported, mapped and balanced',
    run: async (tx, id) => {
      const f = await loadFinancials(tx, id);
      if (!f.tb) return false;
      const m = mapTrialBalance(applyAdjustments(toTbLines(tbOf(f.tb)), entriesOf(f.adjustments)), mappingOf(f.mapping));
      return !m.empty && m.balanced && m.unmapped.length === 0;
    },
  });
  registerGate('completion', 'review', {
    gate: 'disclosureChecklistComplete',
    message: 'Every item on the disclosure checklist must be satisfied',
    run: async (tx, id) => {
      const eng = await loadEngagement(tx, id);
      if (!eng) return false;
      try {
        const c = computeStatements(eng, await loadFinancials(tx, id));
        return c.result.ok && (c.disclosures ?? []).every((d) => d.satisfied);
      } catch (e) {
        if (e instanceof UnsupportedFrameworkError) return false;
        throw e;
      }
    },
  });
  registerGate('review', 'partner_approved', {
    gate: 'eqrSignedOffWhereRequired',
    message: 'An engagement quality review must be signed off',
    run: async (tx, id) => {
      const eng = await loadEngagement(tx, id);
      if (!eng) return false;
      const required = eng.eqr_id !== null || (eng.risk_profile.riskFlags ?? []).includes('eqr_required');
      if (!required) return true;
      const r = await tx.query("select 1 from wp_items where engagement_id = $1 and kind = 'eqr_review' and state = 'partner_approved' and deleted_at is null limit 1", [id]);
      return (r.rowCount ?? 0) > 0;
    },
  });
}

export async function financialRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  registerFinancialGates();

  const parse = (raw: string) => {
    const id = uuid.safeParse(raw);
    if (!id.success) throw httpError(404, 'not_found');
    return id.data;
  };

  app.post<{ Params: { id: string } }>('/engagements/:id/tb/import', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = parse(req.params.id);
    if (!req.isMultipart()) throw httpError(415, 'multipart_required');
    const ctx = tenantCtx(req);
    const eng = await withTenant(pool, ctx, (tx) => loadEngagement(tx, engagementId));
    if (!eng) throw httpError(404, 'not_found');
    assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });

    const file = await req.file();
    if (!file) throw httpError(400, 'file_required');
    const data = await file.toBuffer();
    const prior = (file.fields.prior as { value?: string } | undefined)?.value === 'true';
    const parsed = await parseTbUpload(file.filename, data);
    if (!parsed.ok) {
      return reply.code(parsed.error === 'unsupported_type' ? 415 : 422).send({ error: parsed.error, ...(parsed.rows ? { rows: parsed.rows } : {}) });
    }
    const kind = prior ? 'trial_balance_prior' : 'trial_balance';
    const out = await withTenant(pool, ctx, async (tx) => {
      const f = await loadFinancials(tx, engagementId, true);
      const saved = await upsertSingleton(
        req, tx, ctx, engagementId, kind, prior ? 'Prior-year trial balance' : 'Trial balance',
        { lines: parsed.lines, source: 'import', importedAt: new Date().toISOString() },
        prior ? f.prior : f.tb,
      );
      const lines = toTbLines(parsed.lines);
      return {
        version: saved.version,
        totalDebit: formatMoney(lines.reduce((a, l) => a + l.debit, 0n)),
        totalCredit: formatMoney(lines.reduce((a, l) => a + l.credit, 0n)),
      };
    });
    return { rows: parsed.lines.length, ...out, balanced: out.totalDebit === out.totalCredit };
  });

  app.get<{ Params: { id: string }; Querystring: { prior?: string } }>('/engagements/:id/tb', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = parse(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId))) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const f = await loadFinancials(tx, engagementId);
      const item = req.query.prior === 'true' ? f.prior : f.tb;
      return { lines: tbOf(item), version: item?.version ?? 0, state: item?.state ?? null, contentHash: item?.content_hash ?? null };
    });
  });

  app.get<{ Params: { id: string } }>('/engagements/:id/mapping', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = parse(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId))) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const f = await loadFinancials(tx, engagementId);
      const mapping = mappingOf(f.mapping);
      const lines = tbOf(f.tb);
      const unmapped = lines.filter((l) => !LINE_IDS.has(mapping[l.code] ?? ''));
      const suggested = suggestMapping(toTbLines(lines), mapping);
      const suggestions = Object.fromEntries(unmapped.filter((l) => suggested[l.code]).map((l) => [l.code, suggested[l.code]]));
      return { mapping, unmapped: unmapped.map((l) => l.code), suggestions, taxonomy: TAXONOMY.map((t) => ({ id: t.id, label: t.label, statement: t.statement })), version: f.mapping?.version ?? 0 };
    });
  });

  app.put<{ Params: { id: string } }>('/engagements/:id/mapping', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = parse(req.params.id);
    const { mapping } = mappingBody.parse(req.body);
    if (Object.keys(mapping).length > 5000) throw httpError(422, 'too_many_accounts');
    const bad = Object.entries(mapping).filter(([, line]) => !LINE_IDS.has(line));
    if (bad.length > 0) throw Object.assign(httpError(422, 'unknown_statement_line'), { detail: bad.map(([code]) => code) });
    const ctx = tenantCtx(req);
    return withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      const f = await loadFinancials(tx, engagementId, true);
      const saved = await upsertSingleton(req, tx, ctx, engagementId, 'fs_mapping', 'Statement mapping', { mapping }, f.mapping);
      return { version: saved.version };
    });
  });

  const respondStatements = async (eng: NonNullable<Awaited<ReturnType<typeof loadEngagement>>>, f: Financials, reply: import('fastify').FastifyReply) => {
    try {
      const c = computeStatements(eng, f);
      return reply.type('application/json; charset=utf-8').send(
        bigintJson({
          ok: c.result.ok,
          frameworkVersion: c.frameworkVersion,
          ...(c.result.ok ? { statements: c.result.statements, exceptions: c.result.exceptions, disclosures: c.disclosures } : { blockers: c.result.blockers }),
          unadjustedTotal: c.unadjustedTotal,
          draft: !APPROVED.has(eng.state),
        }),
      );
    } catch (e) {
      if (e instanceof UnsupportedFrameworkError) {
        return reply.code(422).send({ error: 'framework_not_supported', message: 'Full IFRS statements are not supported yet. Use IFRS for SMEs.' });
      }
      throw e;
    }
  };

  app.get<{ Params: { id: string } }>('/engagements/:id/statements', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = parse(req.params.id);
    const loaded = await withTenant(pool, tenantCtx(req), async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      await recordView(req, tx, { type: 'statements', id: eng.id, label: eng.client_name, engagementId: eng.id });
      return { eng, f: await loadFinancials(tx, engagementId) };
    });
    return respondStatements(loaded.eng, loaded.f, reply);
  });

  app.get<{ Params: { id: string } }>('/engagements/:id/adjustments', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = parse(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId))) throw httpError(404, 'not_found');
      const f = await loadFinancials(tx, engagementId, true);
      const entries = entriesOf(f.adjustments);
      return { entries, unadjustedTotal: unadjustedTotal(entries), version: f.adjustments?.version ?? 0 };
    });
  });

  app.post<{ Params: { id: string } }>('/engagements/:id/adjustments', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = parse(req.params.id);
    const body = adjustmentBody.parse(req.body);
    const ctx = tenantCtx(req);
    const entry = await withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      if (body.status === 'agreed') assertCan(req, 'engagement.transition', { assigned: true });
      const f = await loadFinancials(tx, engagementId, true);
      const known = new Set(tbOf(f.tb).map((l) => l.code));
      let debit = 0n;
      let credit = 0n;
      const lines = body.lines.map((l) => {
        let d: bigint;
        let c: bigint;
        try {
          d = parseMoney(l.debit || '0');
          c = parseMoney(l.credit || '0');
        } catch {
          throw httpError(422, 'invalid_amount');
        }
        if (d < 0n || c < 0n || (d !== 0n && c !== 0n) || (d === 0n && c === 0n)) throw httpError(422, 'invalid_amount');
        if (!known.has(l.code)) throw httpError(422, 'unknown_account');
        debit += d;
        credit += c;
        return { code: l.code, debit: formatMoney(d), credit: formatMoney(c) };
      });
      if (debit !== credit) throw httpError(422, 'entry_unbalanced');
      const entry: AdjustmentEntry = { id: randomUUID(), description: body.description, status: body.status, lines, createdBy: ctx.userId, createdAt: new Date().toISOString() };
      await upsertSingleton(req, tx, ctx, engagementId, 'adjustments', 'Adjustments journal', { entries: [...entriesOf(f.adjustments), entry] }, f.adjustments);
      return entry;
    });
    return reply.code(201).send({ id: entry.id });
  });

  app.patch<{ Params: { id: string; entryId: string } }>('/engagements/:id/adjustments/:entryId', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = parse(req.params.id);
    const { status } = statusBody.parse(req.body);
    const ctx = tenantCtx(req);
    return withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.transition', { assigned: true });
      const f = await loadFinancials(tx, engagementId, true);
      const entries = entriesOf(f.adjustments);
      if (!entries.some((e) => e.id === req.params.entryId)) throw httpError(404, 'not_found');
      const next = entries.map((e) => (e.id === req.params.entryId ? { ...e, status } : e));
      await upsertSingleton(req, tx, ctx, engagementId, 'adjustments', 'Adjustments journal', { entries: next }, f.adjustments);
      return { status };
    });
  });

  app.post<{ Params: { id: string } }>('/engagements/:id/financials/carry-forward', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = parse(req.params.id);
    const ctx = tenantCtx(req);
    return withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      const snap = (await tx.query('select * from engagement_prior_snapshot($1)', [engagementId])).rows as { prior_engagement: string; kind: string; content: Record<string, unknown> }[];
      const f = await loadFinancials(tx, engagementId);
      let carriedMapping = false;
      let carriedPriorYear = false;
      const prevMapping = snap.find((r) => r.kind === 'fs_mapping');
      if (prevMapping && !f.mapping) {
        await upsertSingleton(req, tx, ctx, engagementId, 'fs_mapping', 'Statement mapping', { mapping: prevMapping.content.mapping, source: 'carry-forward' }, undefined);
        carriedMapping = true;
      }
      const prevTb = snap.find((r) => r.kind === 'trial_balance');
      if (prevTb) {
        const prevAdj = snap.find((r) => r.kind === 'adjustments');
        const adjusted = applyAdjustments(toTbLines(prevTb.content.lines as never), (prevAdj?.content.entries as AdjustmentEntry[] | undefined) ?? []);
        await upsertSingleton(
          req, tx, ctx, engagementId, 'trial_balance_prior', 'Prior-year trial balance',
          { lines: fromTbLines(adjusted), source: 'carry-forward', fromEngagement: prevTb.prior_engagement },
          f.prior,
        );
        carriedPriorYear = true;
      }
      return { carriedMapping, carriedPriorYear };
    });
  });

  app.get<{ Params: { id: string } }>('/engagements/:id/fs-notes', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = parse(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId))) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const f = await loadFinancials(tx, engagementId);
      return { notes: f.notes.map((n) => ({ id: n.id, noteId: n.content.noteId, title: n.title, text: n.content.text, state: n.state })) };
    });
  });

  app.post<{ Params: { id: string } }>('/engagements/:id/fs-notes', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = parse(req.params.id);
    const body = noteBody.parse(req.body);
    const ctx = tenantCtx(req);
    await withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      const f = await loadFinancials(tx, engagementId, true);
      const existing = f.notes.find((n) => n.content.noteId === body.noteId);
      const content = { noteId: body.noteId, text: body.text };
      if (existing) {
        const { editItemTx } = await import('../doc-control/service');
        await editItemTx(req, tx, existing, { title: body.title, content, reason: 'Updated note' });
      } else {
        await tx.query("insert into wp_items (tenant_id, engagement_id, kind, title, content, created_by) values ($1, $2, 'fs_note', $3, $4, $5)", [
          ctx.tenantId, engagementId, body.title, JSON.stringify(content), ctx.userId,
        ]);
      }
    });
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/engagements/:id/export', { config: { access: 'tenant', stepUp: true } }, async (req, reply) => {
    const engagementId = parse(req.params.id);
    const { format } = exportBody.parse(req.body);
    const ctx = tenantCtx(req);
    const loaded = await withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'export', { assigned: true });
      const f = await loadFinancials(tx, engagementId);
      const email = (await tx.query('select email from users where id = $1', [ctx.userId])).rows[0]?.email as string;
      return { eng, f, email };
    });
    let computed;
    try {
      computed = computeStatements(loaded.eng, loaded.f);
    } catch (e) {
      if (e instanceof UnsupportedFrameworkError) return reply.code(422).send({ error: 'framework_not_supported' });
      throw e;
    }
    if (!computed.result.ok) return reply.code(409).send({ error: 'statements_blocked', blockers: computed.result.blockers });

    const draft = !APPROVED.has(loaded.eng.state);
    const meta: ExportMeta = {
      entityName: loaded.eng.client_name,
      periodEnd: loaded.eng.period_end,
      draft,
      exportedBy: loaded.email,
      exportedAt: new Date().toISOString(),
      trialBalance: applyAdjustments(toTbLines(tbOf(loaded.f.tb)), entriesOf(loaded.f.adjustments)),
    };
    const s = computed.result.statements;
    const buf = format === 'docx' ? await exportDocx(s, meta) : format === 'xlsx' ? await exportXlsx(s, meta) : await exportPdf(s, meta);
    await withTenant(pool, ctx, (tx) => appendEvent(tx, { action: 'export.created', entityType: 'engagement', entityId: engagementId, detail: { format, draft } }));
    const safeName = loaded.eng.client_name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60) || 'statements';
    return reply
      .header('content-type', TYPES[format])
      .header('content-disposition', `attachment; filename="${safeName}_${loaded.eng.period_end}${draft ? '_DRAFT' : ''}.${format}"`)
      .send(buf);
  });
}
