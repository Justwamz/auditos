import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendEvent } from '@auditos/audit-log';
import { withTenant } from '@auditos/db';
import { formatMoney, parseMoney, projectExceptions, selectMonetaryUnit, selectRandom, selectTop, type PopulationItem, type Selected } from '@auditos/fs-engine';
import { assertCan, httpError, tenantCtx } from '../authz';
import { recordView } from '../audit/views';
import { loadEngagement } from '../engagements/service';
import { parsePopulation } from './population';

const uuid = z.string().uuid();
const createFields = z.object({
  title: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(500).optional(),
  method: z.enum(['random', 'monetary_unit', 'top']),
  size: z.coerce.number().int().min(1).max(500),
  seed: z.string().trim().min(1).max(80).optional(),
});
const resultBody = z.object({
  result: z.enum(['pending', 'supported', 'exception', 'not_tested']),
  misstatement: z.string().trim().max(30).optional(),
  note: z.string().trim().max(1000).optional(),
  evidenceItemId: uuid.nullable().optional(),
});

const fieldValue = (f: unknown): string | undefined => (f as { value?: string } | undefined)?.value;
const hashOf = (items: PopulationItem[]): string => {
  const h = createHash('sha256');
  for (const i of items) h.update(`${i.ref}|${i.description}|${i.amountCents}\n`);
  return h.digest('hex');
};
const clean = (s: string): string => s.replace(/[\r\n]+/g, ' ').slice(0, 200);

interface ScheduleRow {
  id: string; title: string; objective: string | null; method: 'random' | 'monetary_unit' | 'top'; seed: string; requested_size: number;
  population_count: number; population_total_cents: string; population_hash: string; interval_cents: string | null; created_at: Date; created_by_name: string;
}
interface ItemRow {
  id: string; position: number; ref: string; description: string; amount_cents: string; reason: string; result: 'pending' | 'supported' | 'exception' | 'not_tested';
  misstatement_cents: string | null; note: string | null; evidence_item_id: string | null; evidence_title: string | null; tested_at: Date | null; tested_by_name: string | null;
}

const SCHEDULES = `select s.id, s.title, s.objective, s.method, s.seed, s.requested_size, s.population_count, s.population_total_cents::text, s.population_hash,
       s.interval_cents::text, s.created_at, u.full_name as created_by_name
  from sampling_schedules s join users u on u.id = s.created_by`;
const ITEMS = `select i.id, i.position, i.ref, i.description, i.amount_cents::text, i.reason, i.result, i.misstatement_cents::text, i.note, i.evidence_item_id,
       w.title as evidence_title, i.tested_at, u.full_name as tested_by_name
  from sample_items i left join users u on u.id = i.tested_by left join wp_items w on w.id = i.evidence_item_id`;

const itemJson = (i: ItemRow) => ({
  id: i.id, position: i.position, ref: i.ref, description: i.description, amount: formatMoney(BigInt(i.amount_cents)), reason: i.reason, result: i.result,
  misstatement: i.misstatement_cents === null ? null : formatMoney(BigInt(i.misstatement_cents)), note: i.note,
  evidence: i.evidence_item_id ? { id: i.evidence_item_id, title: i.evidence_title } : null, testedAt: i.tested_at, testedBy: i.tested_by_name,
});

function summarise(s: ScheduleRow, items: ItemRow[]) {
  const tested = items.filter((i) => i.result === 'supported' || i.result === 'exception');
  const exceptions = items.filter((i) => i.result === 'exception');
  const proj = projectExceptions({
    method: s.method, populationCents: BigInt(s.population_total_cents), populationCount: s.population_count, tested: tested.length,
    ...(s.interval_cents ? { intervalCents: BigInt(s.interval_cents) } : {}),
    exceptions: exceptions.map((e) => ({ bookCents: BigInt(e.amount_cents), misstatementCents: BigInt(e.misstatement_cents ?? '0') })),
  });
  const sum = (xs: ItemRow[]) => xs.reduce((a, i) => a + BigInt(i.amount_cents), 0n);
  return {
    selected: items.length, pending: items.filter((i) => i.result === 'pending').length, supported: items.filter((i) => i.result === 'supported').length,
    exceptions: exceptions.length, notTested: items.filter((i) => i.result === 'not_tested').length, testedValue: formatMoney(sum(tested)),
    misstatementFound: formatMoney(exceptions.reduce((a, i) => a + BigInt(i.misstatement_cents ?? '0'), 0n)),
    exceptionRate: proj.exceptionRate, projected: proj.projectedCents === null ? null : formatMoney(proj.projectedCents), note: proj.note,
    complete: items.length > 0 && items.every((i) => i.result !== 'pending'),
  };
}

const scheduleJson = (s: ScheduleRow) => ({
  id: s.id, title: s.title, objective: s.objective, method: s.method, seed: s.seed, requestedSize: s.requested_size, populationCount: s.population_count,
  populationTotal: formatMoney(BigInt(s.population_total_cents)), populationFingerprint: s.population_hash, interval: s.interval_cents ? formatMoney(BigInt(s.interval_cents)) : null,
  createdBy: s.created_by_name, createdAt: s.created_at,
});

export async function samplingRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  const id = (v: string) => {
    const p = uuid.safeParse(v);
    if (!p.success) throw httpError(404, 'not_found');
    return p.data;
  };

  /** Draws the sample from an uploaded population. The seed is recorded (or made up and recorded) so the draw can be repeated. */
  app.post<{ Params: { id: string } }>('/engagements/:id/sampling', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = id(req.params.id);
    if (!req.isMultipart()) throw httpError(415, 'multipart_required');
    const ctx = tenantCtx(req);
    const eng = await withTenant(pool, ctx, (tx) => loadEngagement(tx, engagementId));
    if (!eng) throw httpError(404, 'not_found');
    assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });

    const file = await req.file();
    if (!file) throw httpError(400, 'file_required');
    const f = createFields.parse({
      title: fieldValue(file.fields.title), objective: fieldValue(file.fields.objective) || undefined, method: fieldValue(file.fields.method),
      size: fieldValue(file.fields.size), seed: fieldValue(file.fields.seed) || undefined,
    });
    const pop = await parsePopulation(file.filename, await file.toBuffer());
    if (!pop.ok) {
      return reply.code(pop.error === 'unsupported_type' ? 415 : 422).send({ error: pop.error, ...(pop.rows ? { rows: pop.rows } : {}) });
    }
    const seed = f.seed ?? randomBytes(6).toString('hex');
    let selected: Selected[];
    let interval: bigint | null = null;
    if (f.method === 'random') selected = selectRandom(pop.items, f.size, seed);
    else if (f.method === 'top') selected = selectTop(pop.items, f.size);
    else {
      const m = selectMonetaryUnit(pop.items, f.size, seed);
      selected = m.selected;
      interval = m.intervalCents;
    }
    if (selected.length === 0) return reply.code(422).send({ error: 'nothing_selected' });
    const total = pop.items.reduce((a, i) => a + (i.amountCents < 0n ? -i.amountCents : i.amountCents), 0n);

    const sid = await withTenant(pool, ctx, async (tx) => {
      const r = await tx.query(
        `insert into sampling_schedules (tenant_id, engagement_id, title, objective, method, seed, requested_size, population_count, population_total_cents, population_hash, interval_cents)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [ctx.tenantId, engagementId, f.title, f.objective ?? null, f.method, seed, f.size, pop.items.length, total.toString(), hashOf(pop.items), interval?.toString() ?? null],
      );
      const scheduleId = r.rows[0].id as string;
      for (const [position, s] of selected.entries()) {
        const item = pop.items[s.index]!;
        await tx.query(
          'insert into sample_items (tenant_id, schedule_id, position, ref, description, amount_cents, reason) values ($1, $2, $3, $4, $5, $6, $7)',
          [ctx.tenantId, scheduleId, position + 1, item.ref, item.description, item.amountCents.toString(), s.reason],
        );
      }
      await appendEvent(tx, { action: 'evidence.sample_drawn', entityType: 'sampling_schedule', entityId: scheduleId,
        detail: { label: clean(f.title), engagementId, clientName: eng.client_name, method: f.method, selected: selected.length, population: pop.items.length } });
      return scheduleId;
    });
    return reply.code(201).send({ id: sid, seed, selected: selected.length, populationCount: pop.items.length, populationTotal: formatMoney(total) });
  });

  app.get<{ Params: { id: string } }>('/engagements/:id/sampling', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = id(req.params.id);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      if (!(await loadEngagement(tx, engagementId))) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const schedules = (await tx.query(`${SCHEDULES} where s.engagement_id = $1 order by s.created_at desc`, [engagementId])).rows as ScheduleRow[];
      const out = [];
      for (const s of schedules) {
        const items = (await tx.query(`${ITEMS} where i.schedule_id = $1`, [s.id])).rows as ItemRow[];
        out.push({ ...scheduleJson(s), progress: summarise(s, items) });
      }
      return { schedules: out };
    });
  });

  app.get<{ Params: { id: string; sid: string } }>('/engagements/:id/sampling/:sid', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = id(req.params.id);
    const sid = id(req.params.sid);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      const s = (await tx.query(`${SCHEDULES} where s.id = $1 and s.engagement_id = $2`, [sid, engagementId])).rows[0] as ScheduleRow | undefined;
      if (!s) throw httpError(404, 'not_found');
      const items = (await tx.query(`${ITEMS} where i.schedule_id = $1 order by i.position`, [sid])).rows as ItemRow[];
      await recordView(req, tx, { type: 'sampling', id: sid, label: clean(s.title), clientName: eng.client_name, engagementId });
      return { ...scheduleJson(s), summary: summarise(s, items), items: items.map(itemJson) };
    });
  });

  /** Records what testing one selected item found. A result can be revised while the engagement is open; each change is logged. */
  app.patch<{ Params: { id: string; sid: string; iid: string } }>('/engagements/:id/sampling/:sid/items/:iid', { config: { access: 'tenant' } }, async (req) => {
    const engagementId = id(req.params.id);
    const sid = id(req.params.sid);
    const iid = id(req.params.iid);
    const body = resultBody.parse(req.body);
    let misstatement: bigint | null = null;
    if (body.misstatement) {
      try { misstatement = parseMoney(body.misstatement.replace(/[,\s]/g, '')); } catch { throw httpError(422, 'invalid_misstatement'); }
    }
    const ctx = tenantCtx(req);
    return withTenant(pool, ctx, async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      const s = (await tx.query('select title from sampling_schedules where id = $1 and engagement_id = $2', [sid, engagementId])).rows[0] as { title: string } | undefined;
      if (!s) throw httpError(404, 'not_found');
      const cur = (await tx.query('select ref, evidence_item_id from sample_items where id = $1 and schedule_id = $2', [iid, sid])).rows[0] as { ref: string; evidence_item_id: string | null } | undefined;
      if (!cur) throw httpError(404, 'not_found');
      const evidence = body.evidenceItemId === undefined ? cur.evidence_item_id : body.evidenceItemId;
      try {
        await tx.query('update sample_items set result = $2, misstatement_cents = $3, note = $4, evidence_item_id = $5 where id = $1',
          [iid, body.result, misstatement?.toString() ?? null, body.note ?? null, evidence]);
      } catch (e) {
        const msg = (e as { message?: string }).message ?? '';
        if (/exception_needs_note|not_tested_needs_note/.test(msg)) throw httpError(422, 'note_required');
        if (/exception_needs_amount/.test(msg)) throw httpError(422, 'misstatement_required');
        if (/invalid_evidence/.test(msg)) throw httpError(422, 'invalid_evidence');
        throw e;
      }
      await appendEvent(tx, { action: 'evidence.sample_tested', entityType: 'sampling_schedule', entityId: sid,
        detail: { label: clean(s.title), ref: clean(cur.ref), result: body.result, engagementId, clientName: eng.client_name, ...(body.note ? { note: clean(body.note) } : {}) } });
      return { ok: true };
    });
  });

  /** A schedule nobody has tested anything on yet can be thrown away and drawn again. */
  app.delete<{ Params: { id: string; sid: string } }>('/engagements/:id/sampling/:sid', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = id(req.params.id);
    const sid = id(req.params.sid);
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const eng = await loadEngagement(tx, engagementId);
      if (!eng) throw httpError(404, 'not_found');
      assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });
      const s = (await tx.query('select title from sampling_schedules where id = $1 and engagement_id = $2', [sid, engagementId])).rows[0] as { title: string } | undefined;
      if (!s) throw httpError(404, 'not_found');
      if ((await tx.query("select 1 from sample_items where schedule_id = $1 and result <> 'pending' limit 1", [sid])).rowCount) throw httpError(409, 'schedule_in_use');
      await tx.query('delete from sampling_schedules where id = $1', [sid]);
      await appendEvent(tx, { action: 'evidence.sample_discarded', entityType: 'sampling_schedule', entityId: sid, detail: { label: clean(s.title), engagementId, clientName: eng.client_name } });
      return reply.code(204).send();
    });
  });
}
