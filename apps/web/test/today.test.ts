import { describe, expect, test } from 'vitest';
import { buildToday, greetingFor } from '../lib/today';

const base = { role: 'manager', isAdmin: false, awaitingReview: [], myDrafts: [], openNotes: 0, milestones: [], today: '2026-10-28' };
const papers = [
  { id: 'p1', title: 'Cash count', engagementId: 'e1', clientName: 'Mwangaza Traders Ltd', level: 'manager' },
  { id: 'p2', title: 'Debtors', engagementId: 'e2', clientName: 'Pwani Foods', level: 'partner' },
];

describe('buildToday', () => {
  test('a manager with two papers waiting gets two action rows with exact links', () => {
    const rows = buildToday({ ...base, awaitingReview: papers });
    const review = rows.filter((r) => r.href.includes('?tab=papers'));
    expect(review).toHaveLength(2);
    expect(review.every((r) => r.tone === 'action')).toBe(true);
    expect(review.map((r) => r.href)).toEqual(['/engagements/e1?tab=papers&item=p1', '/engagements/e2?tab=papers&item=p2']);
  });
  test('staff get no review rows', () => {
    const rows = buildToday({ ...base, role: 'staff', awaitingReview: papers });
    expect(rows).toEqual([]);
  });
  test('staff do get their drafts and open notes', () => {
    const rows = buildToday({ ...base, role: 'staff', myDrafts: [{ id: 'd1', title: 'Stock', engagementId: 'e1', clientName: 'Mwangaza' }], openNotes: 2 });
    expect(rows).toHaveLength(2);
  });
  test('overdue count 0 gives no invoice row, count 2 gives one exact row', () => {
    expect(buildToday({ ...base, overdue: { count: 0, total: 'KES 0.00' } })).toEqual([]);
    const rows = buildToday({ ...base, overdue: { count: 2, total: 'KES 5,000.00' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe('2 invoices are overdue (KES 5,000.00)');
    expect(rows[0]!.href).toBe('/invoices');
    expect(rows[0]!.tone).toBe('warn');
    expect(buildToday({ ...base, overdue: { count: 1, total: 'KES 100.00' } })[0]!.text).toBe('1 invoice is overdue (KES 100.00)');
  });
  test('a milestone 6 days away is included and one 20 days away is not', () => {
    const rows = buildToday({
      ...base,
      milestones: [
        { date: '2026-11-03', title: 'Year end: Pwani Foods', engagementId: 'e2' },
        { date: '2026-11-17', title: 'Year end: Far Ltd', engagementId: 'e3' },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toContain('Pwani Foods');
    expect(rows[0]!.href).toBe('/engagements/e2');
  });
  test('firm_admin gets nothing', () => {
    expect(buildToday({ ...base, role: 'firm_admin', awaitingReview: papers, openNotes: 3, overdue: { count: 2, total: 'KES 1' } })).toEqual([]);
  });
  test('empty input gives nothing', () => {
    expect(buildToday(base)).toEqual([]);
  });
  test('action rows come before warnings', () => {
    const rows = buildToday({
      ...base,
      awaitingReview: papers,
      overdue: { count: 1, total: 'KES 1.00' },
      milestones: [{ date: '2026-10-30', title: 'Report date: X', engagementId: 'e1' }],
    });
    const tones = rows.map((r) => r.tone);
    expect(tones).toEqual([...tones].sort((a, b) => (a === b ? 0 : a === 'action' ? -1 : 1)));
    expect(tones[0]).toBe('action');
    expect(tones.at(-1)).toBe('warn');
  });
});

describe('greetingFor (Nairobi hour, UTC+3)', () => {
  const at = (utc: string) => greetingFor(new Date(utc));
  test('morning until 11:59, afternoon from 12:00', () => {
    expect(at('2026-10-28T08:59:00Z')).toBe('Good morning'); // 11:59 Nairobi
    expect(at('2026-10-28T09:00:00Z')).toBe('Good afternoon'); // 12:00
  });
  test('afternoon until 16:59, evening from 17:00', () => {
    expect(at('2026-10-28T13:59:00Z')).toBe('Good afternoon'); // 16:59
    expect(at('2026-10-28T14:00:00Z')).toBe('Good evening'); // 17:00
  });
  test('around midnight', () => {
    expect(at('2026-10-28T20:59:00Z')).toBe('Good evening'); // 23:59
    expect(at('2026-10-28T21:00:00Z')).toBe('Good morning'); // 00:00
  });
});
