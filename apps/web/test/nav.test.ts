import { describe, expect, test } from 'vitest';
import { billingTabs, navFor, qualityTabs } from '../lib/nav';

const summary = (role: string, isAdmin = false) =>
  navFor(role, isAdmin).map((g) => `${g.heading ?? '-'}: ${g.items.map((i) => i.href).join(' ')}`);

const TODAY = '-: /';
const HELP = '-: /help';

describe('navFor', () => {
  test('staff and senior', () => {
    const expected = [TODAY, 'My work: /calendar /timesheet', 'Clients and audits: /clients /engagements', 'Business: /pipeline', 'Firm: /independence', HELP];
    expect(summary('staff')).toEqual(expected);
    expect(summary('senior')).toEqual(expected);
  });
  test('manager and partner see billing, the trail and nothing of people', () => {
    const expected = [TODAY, 'My work: /calendar /timesheet', 'Clients and audits: /clients /engagements', 'Business: /pipeline /billing', 'Firm: /independence', HELP];
    expect(summary('manager')).toEqual(expected);
    expect(summary('partner')).toEqual(expected);
  });
  test('partner who is a site administrator also manages people', () => {
    expect(summary('partner', true)).toEqual([TODAY, 'My work: /calendar /timesheet', 'Clients and audits: /clients /engagements', 'Business: /pipeline /billing', 'Firm: /independence /admin/users', HELP]);
  });
  test('staff who is a site administrator gets billing and people', () => {
    expect(summary('staff', true)).toEqual([TODAY, 'My work: /calendar /timesheet', 'Clients and audits: /clients /engagements', 'Business: /pipeline /billing', 'Firm: /independence /admin/users', HELP]);
  });
  test('firm administrator has no Today, no Prospects, no work pages', () => {
    const expected = ['Clients and audits: /clients', 'Business: /billing', 'Firm: /independence /admin/users', HELP];
    expect(summary('firm_admin', false)).toEqual(expected);
    expect(summary('firm_admin', true)).toEqual(expected);
  });
  test('menu names', () => {
    const labels = navFor('partner', true).flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toEqual(['Today', 'Calendar', 'Timesheet', 'Clients', 'Engagements', 'Prospects', 'Billing', 'Quality and independence', 'People', 'Help']);
  });
  test('no empty group and at most five headings, for every role', () => {
    for (const role of ['staff', 'senior', 'manager', 'partner', 'firm_admin']) {
      for (const isAdmin of [false, true]) {
        const groups = navFor(role, isAdmin);
        expect(groups.every((g) => g.items.length > 0)).toBe(true);
        expect(groups.filter((g) => g.heading !== null).length).toBeLessThanOrEqual(5);
        // The fixed menu has ten links in all; a partner who is also an administrator sees every one.
        expect(groups.flatMap((g) => g.items).length).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('tab bars', () => {
  const shown = (tabs: { label: string; show: boolean }[]) => tabs.filter((t) => t.show).map((t) => t.label);
  test('billingTabs is empty for staff', () => {
    expect(billingTabs('staff', false)).toEqual([]);
  });
  test('billingTabs for a partner', () => {
    expect(shown(billingTabs('partner', false))).toEqual(['Overview', 'Invoices', 'Quotations', 'Sent emails', 'Settings']);
    expect(billingTabs('partner', false).map((t) => t.href)).toEqual(['/billing', '/invoices', '/quotes', '/billing/outbox', '/billing/settings']);
  });
  test('qualityTabs hides Activity history from a senior', () => {
    expect(shown(qualityTabs('senior', false))).toEqual(['Independence']);
    expect(shown(qualityTabs('manager', false))).toEqual(['Independence', 'Activity history']);
    expect(shown(qualityTabs('firm_admin', false))).toContain('Activity history');
  });
});
