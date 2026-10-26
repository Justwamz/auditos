import type { Pool, PoolClient } from 'pg';

export interface TenantCtx {
  tenantId: string;
  userId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(pool: Pool, ctx: TenantCtx, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(ctx.tenantId) || !UUID_RE.test(ctx.userId)) {
    throw new Error('invalid tenant context: ids must be UUIDs');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [
      ctx.tenantId,
      ctx.userId,
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction bound to a user only (no tenant), used before a tenant is selected. */
export async function withUser<T>(pool: Pool, userId: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error('invalid user context: id must be a UUID');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
