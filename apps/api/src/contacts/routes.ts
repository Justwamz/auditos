import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { appendEvent } from '@auditos/audit-log';
import { withTenant } from '@auditos/db';
import { actorOf, httpError, tenantCtx } from '../authz';
import { decrypt, encrypt } from '../security/crypto';
import { maskEmail, maskId, maskPhone, maskPin } from './mask';

const uuid = z.string().uuid();
const FIELDS = ['phone', 'email', 'idNumber', 'kraPin'] as const;
type Field = (typeof FIELDS)[number];
const COLUMN: Record<Field, string> = { phone: 'phone_enc', email: 'email_enc', idNumber: 'id_number_enc', kraPin: 'kra_pin_enc' };
const MASK: Record<Field, (v: string) => string> = { phone: maskPhone, email: maskEmail, idNumber: maskId, kraPin: maskPin };

const text = (max: number) => z.string().trim().min(1).max(max);
const contactBody = z.object({
  name: z.string().trim().min(2).max(120),
  position: text(120).optional(),
  phone: text(30).optional(),
  email: z.string().trim().email().max(254).optional(),
  idNumber: text(20).optional(),
  kraPin: z.string().trim().toUpperCase().regex(/^[AP]\d{9}[A-Z]$/, 'a KRA PIN looks like A012345678B').optional(),
});
const patchBody = contactBody.partial().refine((b) => Object.keys(b).length > 0, 'nothing to change');
const revealBody = z.object({ field: z.enum(FIELDS), reason: z.string().trim().min(5).max(300) });

interface ContactRow {
  id: string;
  name: string;
  position: string | null;
  phone_enc: string | null;
  email_enc: string | null;
  id_number_enc: string | null;
  kra_pin_enc: string | null;
}

/** Stored values are decrypted only to be masked; nothing here returns a plain value. */
function present(r: ContactRow) {
  const out = (f: Field): string | null => {
    const blob = r[COLUMN[f] as keyof ContactRow] as string | null;
    return blob ? MASK[f](decrypt(blob)) : null;
  };
  return { id: r.id, name: r.name, position: r.position, phone: out('phone'), email: out('email'), idNumber: out('idNumber'), kraPin: out('kraPin') };
}

const COLUMNS = 'id, name, position, phone_enc, email_enc, id_number_enc, kra_pin_enc';

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  /** The client must be visible to the caller (clients row-level rules); a firm admin who holds no work role has no business here. */
  async function requireClient(req: Parameters<typeof actorOf>[0], tx: PoolClient, rawId: string): Promise<{ id: string; name: string }> {
    const id = uuid.safeParse(rawId);
    if (!id.success) throw httpError(404, 'not_found');
    const actor = actorOf(req);
    if (actor.role === 'firm_admin') throw httpError(403, 'forbidden');
    const c = (await tx.query('select id, name from clients where id = $1', [id.data])).rows[0] as { id: string; name: string } | undefined;
    if (!c) throw httpError(404, 'not_found');
    return c;
  }

  app.get<{ Params: { id: string } }>('/clients/:id/contacts', { config: { access: 'tenant' } }, async (req) => {
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const c = await requireClient(req, tx, req.params.id);
      const rows = (await tx.query(`select ${COLUMNS} from client_contacts where client_id = $1 order by name`, [c.id])).rows as ContactRow[];
      return { contacts: rows.map(present) };
    });
  });

  app.post<{ Params: { id: string } }>('/clients/:id/contacts', { config: { access: 'tenant' } }, async (req, reply) => {
    const body = contactBody.parse(req.body);
    const ctx = tenantCtx(req);
    const id = await withTenant(pool, ctx, async (tx) => {
      const c = await requireClient(req, tx, req.params.id);
      const enc = (v?: string) => (v ? encrypt(v) : null);
      return (
        await tx.query(
          `insert into client_contacts (tenant_id, client_id, name, position, phone_enc, email_enc, id_number_enc, kra_pin_enc, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [ctx.tenantId, c.id, body.name, body.position ?? null, enc(body.phone), enc(body.email), enc(body.idNumber), enc(body.kraPin), ctx.userId],
        )
      ).rows[0].id as string;
    });
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string; cid: string } }>('/clients/:id/contacts/:cid', { config: { access: 'tenant' } }, async (req) => {
    const body = patchBody.parse(req.body);
    const cid = uuid.safeParse(req.params.cid);
    if (!cid.success) throw httpError(404, 'not_found');
    return withTenant(pool, tenantCtx(req), async (tx) => {
      const c = await requireClient(req, tx, req.params.id);
      const sets: string[] = [];
      const params: unknown[] = [cid.data, c.id];
      const set = (col: string, value: unknown) => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (body.name !== undefined) set('name', body.name);
      if (body.position !== undefined) set('position', body.position);
      for (const f of FIELDS) if (body[f] !== undefined) set(COLUMN[f], encrypt(body[f]!));
      const r = await tx.query(`update client_contacts set ${sets.join(', ')} where id = $1 and client_id = $2 returning ${COLUMNS}`, params);
      if (r.rowCount === 0) throw httpError(404, 'not_found');
      return present(r.rows[0] as ContactRow);
    });
  });

  /** The only way a plain value leaves the system. A reason is required and the reveal is written to the audit log first. */
  app.post<{ Params: { id: string; cid: string } }>(
    '/clients/:id/contacts/:cid/reveal',
    { config: { access: 'tenant', rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const body = revealBody.parse(req.body);
      const cid = uuid.safeParse(req.params.cid);
      if (!cid.success) throw httpError(404, 'not_found');
      return withTenant(pool, tenantCtx(req), async (tx) => {
        const c = await requireClient(req, tx, req.params.id);
        const row = (await tx.query(`select ${COLUMNS} from client_contacts where id = $1 and client_id = $2`, [cid.data, c.id])).rows[0] as ContactRow | undefined;
        if (!row) throw httpError(404, 'not_found');
        const blob = row[COLUMN[body.field] as keyof ContactRow] as string | null;
        if (!blob) throw httpError(404, 'not_found');
        await appendEvent(tx, {
          action: 'pii.revealed',
          entityType: 'client_contact',
          entityId: row.id,
          detail: { field: body.field, reason: body.reason, contactName: row.name, clientId: c.id, clientName: c.name },
        });
        return { field: body.field, value: decrypt(blob) };
      });
    },
  );
}
