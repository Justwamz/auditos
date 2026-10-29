import { describe, expect, test } from 'vitest';
import { describeEvent, type AuditRow } from '../src/audit/sentences';

const row = (over: Partial<AuditRow>): AuditRow => ({
  action: 'view.paper', entityType: 'wp_item', actorName: 'Grace Kangethe', detail: {}, clientName: 'Mwangaza Traders Ltd', itemTitle: null, itemKind: null, ...over,
});

describe('describeEvent', () => {
  test('viewing a paper names the paper, its kind and the client', () => {
    expect(describeEvent(row({ detail: { label: 'Stock count', kind: 'workpaper' } }))).toBe('Grace Kangethe viewed the working paper "Stock count" for Mwangaza Traders Ltd');
    expect(describeEvent(row({ detail: { label: 'Engagement letter FY2026', kind: 'engagement_letter' } }))).toBe(
      'Grace Kangethe viewed the engagement letter "Engagement letter FY2026" for Mwangaza Traders Ltd',
    );
  });
  test('viewing a client, opening an engagement and viewing the statements', () => {
    expect(describeEvent(row({ action: 'view.client', entityType: 'client' }))).toBe('Grace Kangethe viewed the client file of Mwangaza Traders Ltd');
    expect(describeEvent(row({ action: 'view.engagement', entityType: 'engagement' }))).toBe('Grace Kangethe opened the audit file for Mwangaza Traders Ltd');
    expect(describeEvent(row({ action: 'view.statements', entityType: 'engagement' }))).toBe('Grace Kangethe viewed the draft financial statements for Mwangaza Traders Ltd');
  });
  test('revealing personal data says which field, whose, and why', () => {
    expect(
      describeEvent(row({ action: 'pii.revealed', entityType: 'client_contact', detail: { field: 'phone', contactName: 'Jane Wambui', reason: 'Calling to confirm the year-end visit' } })),
    ).toBe('Grace Kangethe revealed the phone number of Jane Wambui at Mwangaza Traders Ltd. Reason given: "Calling to confirm the year-end visit"');
    expect(describeEvent(row({ action: 'pii.revealed', entityType: 'client_contact', detail: { field: 'kraPin', contactName: 'Jane Wambui', reason: 'Tax check done' } }))).toContain('KRA PIN');
  });
  test('paper changes use the stored title, the version and the reason', () => {
    expect(describeEvent(row({ action: 'item.created', detail: { kind: 'workpaper', title: 'Stock count' } }))).toBe('Grace Kangethe created the working paper "Stock count" for Mwangaza Traders Ltd');
    expect(describeEvent(row({ action: 'item.edited', detail: { kind: 'workpaper', title: 'Stock count', version: 3, reason: 'Fixed the count' } }))).toBe(
      'Grace Kangethe edited the working paper "Stock count" for Mwangaza Traders Ltd (now version 3). Reason given: "Fixed the count"',
    );
    expect(describeEvent(row({ action: 'item.deleted', detail: { kind: 'workpaper', title: 'Stock count' } }))).toBe('Grace Kangethe deleted the working paper "Stock count" for Mwangaza Traders Ltd');
    expect(describeEvent(row({ action: 'item.state_changed', detail: { kind: 'workpaper', title: 'Stock count', state: 'manager_reviewed', previous_state: 'prepared' } }))).toBe(
      'Grace Kangethe moved the working paper "Stock count" for Mwangaza Traders Ltd from prepared to reviewed by the manager',
    );
  });
  test('sign-offs and their removal', () => {
    expect(describeEvent(row({ action: 'INSERT', entityType: 'signoffs', detail: { level: 'manager' }, itemTitle: 'Stock count', itemKind: 'workpaper' }))).toBe(
      'Grace Kangethe signed off the working paper "Stock count" for Mwangaza Traders Ltd as manager',
    );
    expect(
      describeEvent(row({ action: 'UPDATE', entityType: 'signoffs', detail: { old: { revoked_at: null, level: 'partner' }, new: { revoked_at: '2026-10-27T10:00:00Z', level: 'partner' } }, itemTitle: 'Stock count', itemKind: 'workpaper' })),
    ).toBe('A partner sign-off on the working paper "Stock count" for Mwangaza Traders Ltd was removed because the paper changed');
  });
  test('sign-in, evidence and exports', () => {
    expect(describeEvent(row({ action: 'auth.login', entityType: 'auth', clientName: null }))).toBe('Grace Kangethe signed in');
    expect(describeEvent(row({ action: 'auth.logout', entityType: 'auth', clientName: null }))).toBe('Grace Kangethe signed out');
    expect(describeEvent(row({ action: 'evidence.downloaded', itemTitle: 'Bank statement March', itemKind: 'evidence' }))).toBe(
      'Grace Kangethe downloaded the evidence file "Bank statement March" for Mwangaza Traders Ltd',
    );
    expect(describeEvent(row({ action: 'export.created', entityType: 'engagement', detail: { format: 'pdf', draft: true } }))).toBe(
      'Grace Kangethe exported the draft financial statements as PDF for Mwangaza Traders Ltd',
    );
  });
  test('system events have no person', () => {
    expect(describeEvent(row({ action: 'engagement.auto_locked', entityType: 'engagement', actorName: null }))).toBe('The system locked the file for Mwangaza Traders Ltd after the 60-day deadline');
  });
  test('a branding change names what changed, never a colour code', () => {
    const detail = { changed: ['logo', 'primaryColor'], primaryColor: { old: '#2e6b4c', new: '#1f5f4a' } };
    expect(describeEvent(row({ action: 'branding.updated', entityType: 'branding', clientName: null, detail }))).toBe("Grace Kangethe changed the firm's branding (logo, main colour)");
    expect(describeEvent(row({ action: 'branding.updated', entityType: 'branding', clientName: null, detail: { changed: ['phone', 'email'] } }))).toBe("Grace Kangethe changed the firm's branding (phone number, email address)");
    expect(describeEvent(row({ action: 'branding.updated', entityType: 'branding', clientName: null, detail: {} }))).toBe("Grace Kangethe changed the firm's branding");
  });
  test('an event the renderer does not know is still readable', () => {
    expect(describeEvent(row({ action: 'INSERT', entityType: 'engagement_members', clientName: null }))).toBe('Grace Kangethe added a team member');
    expect(describeEvent(row({ action: 'WEIRD', entityType: 'thing', clientName: null }))).toBe('Grace Kangethe made a change (WEIRD on thing)');
  });
});
