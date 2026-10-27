import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export interface TestTenant {
  id: string;
  adminId: string;
}

export async function createTestUser(owner: Pool, label: string): Promise<string> {
  const id = randomUUID();
  await owner.query('insert into users (id, email, full_name, password_hash) values ($1, $2, $3, $4)', [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
    `Tester ${label}`,
    'x',
  ]);
  return id;
}

/** Owner-side membership insert. Memberships have forced RLS, so the tenant context must be set. */
export async function addTestMember(owner: Pool, tenantId: string, label: string, role: string, grade: number): Promise<string> {
  const userId = await createTestUser(owner, label);
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query('insert into memberships (tenant_id, user_id, role, grade) values ($1, $2, $3, $4)', [
      tenantId,
      userId,
      role,
      grade,
    ]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return userId;
}

export async function createTestTenant(owner: Pool, label: string): Promise<TestTenant> {
  const id = randomUUID();
  await owner.query('insert into tenants (id, name) values ($1, $2)', [id, `Test Firm ${label}`]);
  const adminId = await addTestMember(owner, id, `admin-${label}`, 'firm_admin', 0);
  return { id, adminId };
}
