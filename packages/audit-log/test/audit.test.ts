import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createPools, withTenant } from '@auditos/db';
import { addTestMember, createTestTenant, type TestTenant } from '@auditos/db/testing';
import { appendEvent, verifyChain } from '../src';

let owner: Pool;
let app: Pool;
let t: TestTenant;

const ctx = () => ({ tenantId: t.id, userId: t.adminId });
const events = async (tenantId: string) =>
  (await owner.query('select * from audit_events where tenant_id = $1 order by seq', [tenantId])).rows;

beforeAll(async () => {
  ({ owner, app } = createPools());
  t = await createTestTenant(owner, 'audit');
});
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe('audit log', () => {
  test('appends chained events and verifies', async () => {
    await withTenant(app, ctx(), (tx) => appendEvent(tx, { action: 'test.one', entityType: 'thing', entityId: '1' }));
    await withTenant(app, ctx(), (tx) => appendEvent(tx, { action: 'test.two', entityType: 'thing', entityId: '2', detail: { a: 1 } }));
    const rows = await events(t.id);
    const [first, second] = rows.slice(-2);
    expect(second.prev_hash).toBe(first.hash);
    expect(second.actor_user_id).toBe(t.adminId);
    expect(await verifyChain(owner, t.id)).toEqual({ ok: true });
  });

  test('app role cannot update, delete or insert events directly', async () => {
    await expect(withTenant(app, ctx(), (tx) => tx.query("update audit_events set action = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(withTenant(app, ctx(), (tx) => tx.query('delete from audit_events'))).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(app, ctx(), (tx) =>
        tx.query("insert into audit_events (tenant_id, seq, at, action, entity_type, prev_hash, hash) values ($1, 999, now(), 'forged', 'x', 'a', 'b')", [t.id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  test('tampering is detected', async () => {
    const tenant = await createTestTenant(owner, 'tamper');
    const c = { tenantId: tenant.id, userId: tenant.adminId };
    for (let i = 0; i < 3; i++) await withTenant(app, c, (tx) => appendEvent(tx, { action: `e${i}`, entityType: 'x' }));
    const rows = await events(tenant.id);
    const victim = rows[2];
    await owner.query('update audit_events set detail = $1 where tenant_id = $2 and seq = $3', [JSON.stringify({ forged: true }), tenant.id, victim.seq]);
    expect(await verifyChain(owner, tenant.id)).toEqual({ ok: false, brokenAtSeq: Number(victim.seq) });
  });

  test('deleting a middle event is detected as a broken chain', async () => {
    const tenant = await createTestTenant(owner, 'gap');
    const c = { tenantId: tenant.id, userId: tenant.adminId };
    for (let i = 0; i < 3; i++) await withTenant(app, c, (tx) => appendEvent(tx, { action: `e${i}`, entityType: 'x' }));
    const rows = await events(tenant.id);
    await owner.query('delete from audit_events where tenant_id = $1 and seq = $2', [tenant.id, rows[1].seq]);
    const r = await verifyChain(owner, tenant.id);
    expect(r.ok).toBe(false);
  });

  test('trigger logs inserts on an attached table with the actor', async () => {
    const before = (await events(t.id)).length;
    const newbie = await addTestMember(owner, t.id, 'trigger', 'staff', 1);
    await withTenant(app, ctx(), (tx) => tx.query('update memberships set role = $1 where user_id = $2', ['senior', newbie]));
    const rows = (await events(t.id)).slice(before);
    expect(rows.map((r) => r.action)).toEqual(['INSERT', 'UPDATE']);
    expect(rows[1].entity_type).toBe('memberships');
    expect(rows[1].entity_id).toBe(newbie);
    expect(rows[1].actor_user_id).toBe(t.adminId);
    expect(rows[1].detail.old.role).toBe('staff');
    expect(rows[1].detail.new.role).toBe('senior');
  });

  test('concurrent appends keep a gapless chain', async () => {
    const tenant = await createTestTenant(owner, 'concurrent');
    const c = { tenantId: tenant.id, userId: tenant.adminId };
    const base = (await events(tenant.id)).length;
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => withTenant(app, c, (tx) => appendEvent(tx, { action: `c${i}`, entityType: 'x' }))),
    );
    const rows = await events(tenant.id);
    expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: base + 20 }, (_, i) => i + 1));
    expect(await verifyChain(owner, tenant.id)).toEqual({ ok: true });
  });

  test('a tenant only sees its own events', async () => {
    const other = await createTestTenant(owner, 'other');
    const mine = await withTenant(app, ctx(), async (tx) => (await tx.query('select distinct tenant_id from audit_events')).rows);
    expect(mine).toEqual([{ tenant_id: t.id }]);
    expect(other.id).not.toBe(t.id);
  });

  test('append without a tenant context fails', async () => {
    await expect(app.query("select audit_append('x','y',null,'{}')")).rejects.toThrow(/tenant/i);
  });
});
