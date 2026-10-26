import { createHash, randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendEvent } from '@auditos/audit-log';
import { withTenant } from '@auditos/db';
import { assertCan, httpError, tenantCtx } from '../authz';
import { loadEngagement } from '../engagements/service';
import { LocalBlobStore, StubScanner } from './storage';
import { MAX_UPLOAD_BYTES, sanitizeName, validateUpload } from './validate';

const uuid = z.string().uuid();

export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  const pool = app.pools.app;
  const blobs = app.blobs ?? new LocalBlobStore(app.cfg.uploadDir);
  const scanner = app.scanner ?? new StubScanner();
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });

  app.post<{ Params: { id: string } }>('/engagements/:id/evidence', { config: { access: 'tenant' } }, async (req, reply) => {
    const engagementId = uuid.safeParse(req.params.id);
    if (!engagementId.success) throw httpError(404, 'not_found');
    if (!req.isMultipart()) throw httpError(415, 'multipart_required');
    const ctx = tenantCtx(req);

    // Check membership before reading the body so outsiders cannot make us buffer 25 MB.
    const eng = await withTenant(pool, ctx, (tx) => loadEngagement(tx, engagementId.data));
    if (!eng) throw httpError(404, 'not_found');
    assertCan(req, 'item.edit', { assigned: true, engagementState: eng.state });

    const file = await req.file();
    if (!file) throw httpError(400, 'file_required');
    const data = await file.toBuffer();
    const rawParent = (file.fields.itemId as { value?: string } | undefined)?.value;
    const parent = rawParent ? uuid.safeParse(rawParent) : undefined;
    if (parent && !parent.success) throw httpError(422, 'invalid_parent_item');

    const check = validateUpload(file.filename, data);
    if (!check.ok) return reply.code(422).send({ error: 'invalid_file', reason: check.reason });

    const stored = await withTenant(pool, ctx, async (tx) => {
      if (parent?.success) {
        const ok = await tx.query('select 1 from wp_items where id = $1 and engagement_id = $2 and deleted_at is null', [parent.data, engagementId.data]);
        if (!ok.rowCount) throw httpError(422, 'invalid_parent_item');
      }
      const storageKey = `${ctx.tenantId}/${engagementId.data}/${randomUUID()}`;
      await blobs.put(storageKey, data);
      const { clean } = await scanner.scan(data);
      const content = {
        fileName: check.safeName,
        originalName: sanitizeName(file.filename).slice(0, 200),
        mime: check.mime,
        size: check.size,
        sha256: check.sha256,
        storageKey,
        scanStatus: clean ? 'clean' : 'quarantined',
        ...(parent?.success ? { parentItemId: parent.data } : {}),
      };
      const r = await tx.query(
        "insert into wp_items (tenant_id, engagement_id, kind, title, content, created_by) values ($1, $2, 'evidence', $3, $4, $5) returning id",
        [ctx.tenantId, engagementId.data, check.safeName, JSON.stringify(content), ctx.userId],
      );
      return { id: r.rows[0].id as string, content };
    });
    return reply.code(201).send({
      id: stored.id,
      name: stored.content.fileName,
      size: stored.content.size,
      sha256: stored.content.sha256,
      scanStatus: stored.content.scanStatus,
    });
  });

  app.get<{ Params: { id: string } }>('/evidence/:id/download', { config: { access: 'tenant' } }, async (req, reply) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw httpError(404, 'not_found');
    const ctx = tenantCtx(req);
    const meta = await withTenant(pool, ctx, async (tx) => {
      const r = (await tx.query("select content, deleted_at from wp_items where id = $1 and kind = 'evidence'", [id.data])).rows[0];
      if (!r || r.deleted_at) throw httpError(404, 'not_found');
      assertCan(req, 'engagement.read', { assigned: true });
      if (r.content.scanStatus !== 'clean') throw httpError(409, 'quarantined');
      await appendEvent(tx, { action: 'evidence.downloaded', entityType: 'wp_item', entityId: id.data });
      return r.content as { storageKey: string; fileName: string; sha256: string };
    });
    const bytes = await blobs.get(meta.storageKey);
    if (createHash('sha256').update(bytes).digest('hex') !== meta.sha256) {
      req.log.error({ id: id.data }, 'evidence integrity check failed');
      throw new Error('evidence integrity check failed');
    }
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${meta.fileName}"`)
      .send(bytes);
  });
}
