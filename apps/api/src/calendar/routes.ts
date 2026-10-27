import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@auditos/db';
import { httpError, tenantCtx } from '../authz';
import { listEngagements } from '../engagements/service';
import { milestonesFor } from './milestones';

const uuid = z.string().uuid();
const KINDS = ['meeting', 'fieldwork', 'deadline', 'leave', 'training', 'other'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date');
const instant = z.string().datetime({ offset: true });
const MAX_RANGE_DAYS = 62;

const eventBody = z
  .object({
    title: z.string().trim().min(2).max(200),
    kind: z.enum(KINDS),
    startsAt: instant,
    endsAt: instant,
    allDay: z.boolean().default(false),
    location: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
    clientId: uuid.optional(),
    engagementId: uuid.optional(),
    attendeeIds: z.array(uuid).max(50).default([]),
  })
  .refine((b) => Date.parse(b.endsAt) >= Date.parse(b.startsAt), { message: 'the end must not be before the start', path: ['endsAt'] });

const rangeQuery = z
  .object({ from: day, to: day, person: uuid.optional() })
  .refine((q) => q.to >= q.from, { message: 'to must not be before from', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= MAX_RANGE_DAYS, { message: `ask for at most ${MAX_RANGE_DAYS} days`, path: ['to'] });

interface Row {
  id: string; title: string; kind: string; starts_at: string; ends_at: string; all_day: boolean; location: string | null; notes: string | null;
  client_id: string | null; client_name: string | null; engagement_id: string | null; attendee_ids: string[]; created_by: string; created_by_name: string;
}

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  /** Events in a date range (Nairobi days) plus the engagement milestones the person can see. */
  app.get('/calendar', { config: { access: 'tenant' } }, async (req) => {
    const q = rangeQuery.parse(req.query);
    const ctx = tenantCtx(req);
    return withTenant(pool, ctx, async (tx) => {
      const params: unknown[] = [q.from, q.to];
      let person = '';
      if (q.person) {
        params.push(q.person);
        person = 'and ($3::uuid = e.created_by or $3::uuid = any (e.attendee_ids))';
      }
      const rows = (
        await tx.query(
          `select e.id, e.title, e.kind, e.starts_at, e.ends_at, e.all_day, e.location, e.notes, e.client_id, c.name as client_name, e.engagement_id,
                  e.attendee_ids, e.created_by, coalesce(u.full_name, u.email) as created_by_name
             from calendar_events e
             left join clients c on c.id = e.client_id
             left join users u on u.id = e.created_by
            where e.cancelled_at is null
              and e.starts_at < (($2::date + 1)::timestamp at time zone 'Africa/Nairobi')
              and e.ends_at >= ($1::date::timestamp at time zone 'Africa/Nairobi') ${person}
            order by e.starts_at, e.title`,
          params,
        )
      ).rows as Row[];
      const ids = [...new Set(rows.flatMap((r) => r.attendee_ids))];
      const names = new Map<string, string>(
        ids.length === 0 ? [] : (await tx.query('select id, coalesce(full_name, email) as name from users where id = any ($1::uuid[])', [ids])).rows.map((r) => [r.id as string, r.name as string]),
      );
      const engagements = await listEngagements(tx);
      const milestones = milestonesFor(
        engagements.map((e) => ({ id: e.id, clientName: e.client_name, periodEnd: e.period_end, reportDate: e.report_date, state: e.state })),
        q.from,
        q.to,
      );
      return {
        events: rows.map((r) => ({
          id: r.id, title: r.title, kind: r.kind, startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(), allDay: r.all_day,
          location: r.location, notes: r.notes, clientId: r.client_id, clientName: r.client_name, engagementId: r.engagement_id,
          attendees: r.attendee_ids.map((id) => ({ id, name: names.get(id) ?? 'Unknown' })),
          createdBy: r.created_by, createdByName: r.created_by_name, mine: r.created_by === ctx.userId,
        })),
        milestones,
      };
    });
  });

  app.post('/calendar', { config: { access: 'tenant' } }, async (req, reply) => {
    const b = eventBody.parse(req.body);
    const id = await withTenant(pool, tenantCtx(req), async (tx) =>
      (
        await tx.query('select calendar_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid[]) as id', [
          b.title, b.kind, b.startsAt, b.endsAt, b.allDay, b.location ?? null, b.notes ?? null, b.clientId ?? null, b.engagementId ?? null, b.attendeeIds,
        ])
      ).rows[0].id as string,
    );
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>('/calendar/:id', { config: { access: 'tenant' } }, async (req) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const b = eventBody.parse(req.body);
    await withTenant(pool, tenantCtx(req), (tx) =>
      tx.query('select calendar_update($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid[])', [
        id.data, b.title, b.kind, b.startsAt, b.endsAt, b.allDay, b.location ?? null, b.notes ?? null, b.clientId ?? null, b.engagementId ?? null, b.attendeeIds,
      ]),
    );
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/calendar/:id/cancel', { config: { access: 'tenant' } }, async (req) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    await withTenant(pool, tenantCtx(req), (tx) => tx.query('select calendar_cancel($1)', [id.data]));
    return { ok: true };
  });
}
