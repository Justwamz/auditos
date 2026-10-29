import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { derivePalette, DEFAULT_BRAND, type Adjustment } from '@auditos/brand';
import { withTenant } from '@auditos/db';
import { actorOf, httpError, tenantCtx } from '../authz';
import { checkLogo, LOGO_TOO_BIG, MAX_LOGO_BYTES } from './logo';
import { loadBrandingRow, type BrandingRow } from './theme';

const uuid = z.string().uuid();

/** The firm administrator: the firm_admin role or the administrator permission (partners may not change branding). */
const canEdit = (req: FastifyRequest): boolean => {
  const a = actorOf(req);
  return a.role === 'firm_admin' || a.isAdmin === true;
};

const colour = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Colour codes look like #1a2b3c.');
const blankOr = (rule: RegExp, message: string) => z.string().trim().refine((v) => v === '' || rule.test(v), message);
const body = z
  .object({
    primary: colour,
    secondary: colour,
    phone: blankOr(/^[0-9 +()[\]-]{1,30}$/, 'Phone numbers can use digits, spaces, + - and brackets, up to 30 characters.').optional(),
    email: blankOr(/^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+\.[\x21-\x3f\x41-\x7e]+$/, 'That email address does not look right.')
      .refine((v) => v.length <= 254, 'That email address is too long.')
      .optional(),
    website: blankOr(/^https?:\/\/[\x21-\x7e]+$/i, 'A website address starts with http:// or https://.')
      .refine((v) => v.length <= 300, 'That website address is too long.')
      .optional(),
    footerNote: z.string().trim().max(300, 'The footer note can be at most 300 characters.').optional(),
  })
  .strict();

const save = (tx: PoolClient, b: object) => tx.query('select branding_save($1::jsonb)', [JSON.stringify(b)]);
const EMPTY: BrandingRow = { primary: null, secondary: null, logoId: null, phone: null, email: null, website: null, footerNote: null };

export async function brandingRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;

  const view = async (req: FastifyRequest, adjustments: Adjustment[] = []) =>
    withTenant(pool, { ...tenantCtx(req), readOnly: true }, async (tx) => {
      const row = (await loadBrandingRow(tx)) ?? EMPTY;
      // billing_settings may only be read by people who see billing details: others get blanks.
      const s = (await tx.query('select legal_name, address, kra_pin, bank_details from billing_settings where tenant_id = app_tenant()')).rows[0];
      return {
        branding: {
          primary: row.primary ?? DEFAULT_BRAND.primary,
          secondary: row.secondary ?? DEFAULT_BRAND.secondary,
          phone: row.phone,
          email: row.email,
          website: row.website,
          footerNote: row.footerNote,
          logoId: row.logoId,
          adjustments,
          firm: { legalName: s?.legal_name ?? null, address: s?.address ?? null, kraPin: s?.kra_pin ?? null, bankDetails: s?.bank_details ?? null },
        },
        canEdit: canEdit(req),
      };
    });

  app.get('/branding', { config: { access: 'tenant' } }, async (req) => view(req));

  app.put('/branding', { config: { access: 'tenant' } }, async (req) => {
    if (!canEdit(req)) throw httpError(403, 'forbidden');
    const b = body.parse(req.body);
    const { palette, adjustments } = derivePalette({ primary: b.primary, secondary: b.secondary });
    await withTenant(pool, tenantCtx(req), async (tx) => {
      // Only the adjusted colours are stored. A field left out is kept (the database merges under a lock), a blank one is cleared.
      await save(tx, {
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        ...(b.phone !== undefined ? { phone: b.phone } : {}),
        ...(b.email !== undefined ? { email: b.email } : {}),
        ...(b.website !== undefined ? { website: b.website } : {}),
        ...(b.footerNote !== undefined ? { footerNote: b.footerNote } : {}),
      });
    });
    return view(req, adjustments);
  });

  app.post('/branding/logo', { config: { access: 'tenant' } }, async (req, reply) => {
    if (!canEdit(req)) throw httpError(403, 'forbidden');
    if (!req.isMultipart()) throw httpError(415, 'multipart_required');
    const file = await req.file({ limits: { fileSize: MAX_LOGO_BYTES + 1 } });
    if (!file) throw httpError(400, 'file_required');
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(422).send({ error: 'invalid_file', reason: LOGO_TOO_BIG });
      throw e;
    }
    const check = checkLogo(data);
    if (!check.ok) return reply.code(422).send({ error: 'invalid_file', reason: check.reason });
    const logoId = await withTenant(pool, tenantCtx(req), async (tx) => {
      const id = (await tx.query('select branding_add_logo($1, $2, $3, $4) as id', [check.contentType, data, check.width, check.height])).rows[0].id as string;
      await save(tx, { logoId: id });
      return id;
    });
    return { logoId };
  });

  /** Removes the logo from use; every earlier version stays, because issued documents may still show it. */
  app.delete('/branding/logo', { config: { access: 'tenant' } }, async (req) => {
    if (!canEdit(req)) throw httpError(403, 'forbidden');
    await withTenant(pool, tenantCtx(req), async (tx) => {
      if ((await loadBrandingRow(tx))?.logoId) await save(tx, { logoId: null });
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/branding/logo/:id', { config: { access: 'tenant' } }, async (req, reply) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const row = await withTenant(pool, { ...tenantCtx(req), readOnly: true }, async (tx) => (await tx.query('select content_type, bytes from firm_logos where id = $1', [id.data])).rows[0]);
    if (!row) throw httpError(404, 'not_found');
    return reply
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .type(row.content_type as string)
      .send(row.bytes as Buffer);
  });
}
