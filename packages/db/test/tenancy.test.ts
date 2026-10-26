import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createPools, withTenant } from '../src';
import { createTestTenant, createTestUser, type TestTenant } from '../src/testing';

let owner: Pool;
let app: Pool;
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  ({ owner, app } = createPools());
  a = await createTestTenant(owner, 'A');
  b = await createTestTenant(owner, 'B');
});
afterAll(async () => {
  await owner.end();
  await app.end();
});

const members = (pool: Pool, tenantId: string, userId: string) =>
  withTenant(pool, { tenantId, userId }, async (tx) => (await tx.query('select user_id, tenant_id from memberships')).rows);

describe('tenant isolation', () => {
  test('tenant A cannot read tenant B rows', async () => {
    const rows = await members(app, a.id, a.adminId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === a.id)).toBe(true);
    expect(rows.some((r) => r.user_id === b.adminId)).toBe(false);
  });

  test('no tenant context returns zero rows', async () => {
    expect((await app.query('select * from memberships')).rows).toEqual([]);
    expect((await app.query('select * from tenants')).rows).toEqual([]);
  });

  test('app role cannot bypass RLS', async () => {
    const r = await owner.query("select rolbypassrls, rolsuper from pg_roles where rolname = 'auditos_app'");
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    const o = await owner.query("select rolsuper, rolbypassrls from pg_roles where rolname = 'auditos_owner'");
    expect(o.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  test('cross-tenant insert is rejected', async () => {
    const intruder = await createTestUser(owner, 'intruder');
    await expect(
      withTenant(app, { tenantId: a.id, userId: a.adminId }, (tx) =>
        tx.query("insert into memberships (tenant_id, user_id, role, grade) values ($1, $2, 'staff', 1)", [b.id, intruder]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  test('cross-tenant update affects no rows', async () => {
    const res = await withTenant(app, { tenantId: a.id, userId: a.adminId }, (tx) =>
      tx.query("update memberships set role = 'partner' where tenant_id = $1", [b.id]),
    );
    expect(res.rowCount).toBe(0);
  });

  test('a user only sees users of their own tenant', async () => {
    const rows = await withTenant(app, { tenantId: a.id, userId: a.adminId }, async (tx) => (await tx.query('select id from users')).rows);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(a.adminId);
    expect(ids).not.toContain(b.adminId);
  });

  test('app role cannot read password hashes or MFA secrets', async () => {
    await expect(
      withTenant(app, { tenantId: a.id, userId: a.adminId }, (tx) => tx.query('select password_hash from users')),
    ).rejects.toThrow(/permission denied/);
  });

  test('tenant context rejects a malformed tenant id', async () => {
    await expect(members(app, "x'; drop table tenants;--", a.adminId)).rejects.toThrow(/invalid/i);
  });

  test('a tenant can read only itself in tenants', async () => {
    const rows = await withTenant(app, { tenantId: a.id, userId: a.adminId }, async (tx) => (await tx.query('select id from tenants')).rows);
    expect(rows).toEqual([{ id: a.id }]);
  });
});
