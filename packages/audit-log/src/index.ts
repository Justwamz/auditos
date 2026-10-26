import type { Pool, PoolClient } from 'pg';

export interface AuditEventInput {
  action: string;
  entityType: string;
  entityId?: string;
  detail?: unknown;
}

/** Must run inside withTenant so the tenant and actor come from the session, not the caller. */
export async function appendEvent(tx: PoolClient, e: AuditEventInput): Promise<void> {
  await tx.query('select audit_append($1, $2, $3, $4::jsonb)', [
    e.action,
    e.entityType,
    e.entityId ?? null,
    JSON.stringify(e.detail ?? {}),
  ]);
}

export type ChainResult = { ok: true } | { ok: false; brokenAtSeq: number };

export async function verifyChain(owner: Pool, tenantId: string): Promise<ChainResult> {
  const r = await owner.query('select audit_verify($1) as broken', [tenantId]);
  const broken = r.rows[0]?.broken as string | null;
  return broken === null || broken === undefined ? { ok: true } : { ok: false, brokenAtSeq: Number(broken) };
}
