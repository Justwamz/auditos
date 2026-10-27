import { describe, expect, test } from 'vitest';
import { can, GRADE, type Actor, type Role } from '../src';

const actor = (role: Role, over: Partial<Actor> = {}): Actor => ({
  userId: `u-${role}`,
  tenantId: 't1',
  role,
  active: true,
  ...over,
});

describe('authz policy', () => {
  test('firm_admin cannot read engagement content', () => {
    expect(can(actor('firm_admin'), 'engagement.read', { assigned: true }).allow).toBe(false);
    expect(can(actor('firm_admin'), 'tenant.admin', {}).allow).toBe(true);
  });

  test('unassigned manager cannot read engagement', () => {
    expect(can(actor('manager'), 'engagement.read', { assigned: false }).allow).toBe(false);
    expect(can(actor('manager'), 'engagement.read', { assigned: true }).allow).toBe(true);
  });

  test('preparer cannot sign off own work', () => {
    const m = actor('manager', { userId: 'same' });
    const r = can(m, 'item.signoff.manager', { assigned: true, preparerId: 'same', preparerGrade: GRADE.staff });
    expect(r.allow).toBe(false);
  });

  test('reviewer grade must exceed preparer grade', () => {
    const base = { assigned: true, preparerId: 'p' };
    expect(can(actor('manager'), 'item.signoff.manager', { ...base, preparerGrade: GRADE.manager }).allow).toBe(false);
    expect(can(actor('manager'), 'item.signoff.manager', { ...base, preparerGrade: GRADE.senior }).allow).toBe(true);
    expect(can(actor('senior'), 'item.signoff.manager', { ...base, preparerGrade: GRADE.staff }).allow).toBe(false);
  });

  test('engagement partner cannot be EQR', () => {
    const p = actor('partner');
    expect(can(p, 'engagement.assign_eqr', { assigned: true, engagementPartnerId: 'x', eqrId: 'x' }).allow).toBe(false);
    expect(can(p, 'engagement.assign_eqr', { assigned: true, engagementPartnerId: 'x', eqrId: 'y' }).allow).toBe(true);
  });

  test('only partner may sign off partner level', () => {
    const ctx = { assigned: true, preparerId: 'p', preparerGrade: GRADE.senior };
    expect(can(actor('manager'), 'item.signoff.partner', ctx).allow).toBe(false);
    expect(can(actor('partner'), 'item.signoff.partner', ctx).allow).toBe(true);
  });

  test('unlock requires an approver different from requester and being partner or quality_officer', () => {
    const p = actor('partner', { userId: 'p1' });
    const ok = { assigned: true, approver: { userId: 'p2', role: 'partner' as Role } };
    expect(can(p, 'engagement.unlock', ok).allow).toBe(true);
    expect(can(p, 'engagement.unlock', { ...ok, approver: { userId: 'p1', role: 'partner' as Role } }).allow).toBe(false);
    expect(can(p, 'engagement.unlock', { ...ok, approver: { userId: 'm1', role: 'manager' as Role } }).allow).toBe(false);
    expect(can(p, 'engagement.unlock', { assigned: true }).allow).toBe(false);
    expect(can(p, 'engagement.unlock', { ...ok, approver: { userId: 'q1', role: 'quality_officer' as Role } }).allow).toBe(true);
    expect(can(actor('manager'), 'engagement.unlock', ok).allow).toBe(false);
  });

  test('deactivated user is denied everything', () => {
    const dead = actor('partner', { active: false });
    for (const a of ['engagement.read', 'item.edit', 'item.signoff.partner', 'export'] as const) {
      expect(can(dead, a, { assigned: true }).allow).toBe(false);
    }
  });

  test('locked engagement denies item.edit for all roles', () => {
    for (const r of ['staff', 'senior', 'manager', 'partner'] as Role[]) {
      expect(can(actor(r), 'item.edit', { assigned: true, engagementState: 'locked' }).allow).toBe(false);
    }
  });

  test('editing partner_approved item is partner only', () => {
    const ctx = { assigned: true, itemState: 'partner_approved' as const };
    expect(can(actor('manager'), 'item.edit', ctx).allow).toBe(false);
    expect(can(actor('partner'), 'item.edit', ctx).allow).toBe(true);
  });

  test('delete approval needs a different user of equal or higher grade', () => {
    const ctx = { assigned: true, requesterId: 'r', requesterGrade: GRADE.manager };
    expect(can(actor('manager', { userId: 'r' }), 'item.delete.approve', ctx).allow).toBe(false);
    expect(can(actor('manager', { userId: 'o' }), 'item.delete.approve', ctx).allow).toBe(true);
    expect(can(actor('senior', { userId: 'o' }), 'item.delete.approve', ctx).allow).toBe(false);
  });
});

describe('admin is a permission, not only a role', () => {
  test('a partner holding the admin permission passes tenant.admin and keeps engagement access', () => {
    const p = actor('partner', { isAdmin: true });
    expect(can(p, 'tenant.admin', {}).allow).toBe(true);
    expect(can(p, 'engagement.read', { assigned: true }).allow).toBe(true);
  });
  test('a partner without it does not', () => {
    expect(can(actor('partner'), 'tenant.admin', {}).allow).toBe(false);
    expect(can(actor('manager', { isAdmin: false }), 'tenant.admin', {}).allow).toBe(false);
  });
  test('a deactivated admin gets nothing', () => {
    expect(can(actor('partner', { isAdmin: true, active: false }), 'tenant.admin', {}).allow).toBe(false);
  });
});
