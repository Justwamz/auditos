import { expect, test } from 'vitest';
import { can, type Actor, type Role } from '../src';

const actor = (role: Role, active = true): Actor => ({ userId: 'u', tenantId: 't', role, active });

test('only managers and partners can manage clients, without engagement assignment', () => {
  expect(can(actor('partner'), 'client.manage', {}).allow).toBe(true);
  expect(can(actor('manager'), 'client.manage', {}).allow).toBe(true);
  for (const r of ['senior', 'staff', 'firm_admin', 'quality_officer', 'eqr'] as Role[]) {
    expect(can(actor(r), 'client.manage', {}).allow, r).toBe(false);
  }
  expect(can(actor('partner', false), 'client.manage', {}).allow).toBe(false);
});

test('only managers and partners can create engagements', () => {
  expect(can(actor('manager'), 'engagement.create', {}).allow).toBe(true);
  expect(can(actor('senior'), 'engagement.create', {}).allow).toBe(false);
});

test('only assigned managers and partners can assign members', () => {
  expect(can(actor('manager'), 'engagement.assign', { assigned: true }).allow).toBe(true);
  expect(can(actor('manager'), 'engagement.assign', { assigned: false }).allow).toBe(false);
  expect(can(actor('senior'), 'engagement.assign', { assigned: true }).allow).toBe(false);
});
