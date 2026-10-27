import { describe, expect, test } from 'vitest';
import { addDays, milestonesFor, type MilestoneSource } from '../src/calendar/milestones';

const eng = (over: Partial<MilestoneSource> = {}): MilestoneSource => ({
  id: 'e1', clientName: 'Mwangaza Traders Ltd', periodEnd: '2026-12-31', reportDate: null, state: 'fieldwork', ...over,
});

describe('addDays', () => {
  test('adds days across month and year ends, including leap years', () => {
    expect(addDays('2026-10-27', 60)).toBe('2026-12-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-12-31', 60)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('milestonesFor', () => {
  test('the year end of the period is always a milestone', () => {
    expect(milestonesFor([eng()], '2026-12-01', '2026-12-31')).toEqual([
      { date: '2026-12-31', title: 'Year end: Mwangaza Traders Ltd', engagementId: 'e1', clientName: 'Mwangaza Traders Ltd', kind: 'year_end' },
    ]);
  });

  test('a report date adds the report and the date the file must be locked, 60 days later', () => {
    const m = milestonesFor([eng({ state: 'report_issued', reportDate: '2027-03-15' })], '2027-03-01', '2027-06-30');
    expect(m.map((x) => [x.date, x.kind])).toEqual([['2027-03-15', 'report_date'], ['2027-05-14', 'lock_deadline']]);
    expect(m[1]!.title).toBe('File must be locked: Mwangaza Traders Ltd');
  });

  test('a locked engagement has no lock deadline left', () => {
    const m = milestonesFor([eng({ state: 'locked', reportDate: '2027-03-15' })], '2027-03-01', '2027-06-30');
    expect(m.map((x) => x.kind)).toEqual(['report_date']);
  });

  test('only milestones inside the range are returned, both ends included, in date order', () => {
    const list = [eng({ id: 'a', periodEnd: '2026-06-30' }), eng({ id: 'b', periodEnd: '2026-06-01' }), eng({ id: 'c', periodEnd: '2026-07-01' })];
    expect(milestonesFor(list, '2026-06-01', '2026-06-30').map((x) => x.engagementId)).toEqual(['b', 'a']);
  });

  test('nothing in range gives an empty list', () => {
    expect(milestonesFor([eng()], '2026-01-01', '2026-01-31')).toEqual([]);
  });
});
