import { describe, expect, test } from 'vitest';
import { countByGroup, filterEngagements, STAGE_GROUPS } from '../lib/engagements';

function row(clientName: string, state: string, sector = 'trading') {
  return { clientName, state, sector };
}
const rows = [
  row('Acme Ltd', 'onboarding'),
  row('Baraka Foods', 'planning', 'farming'),
  row('Cheche Co', 'fieldwork'),
  row('Dunia Traders', 'completion'),
  row('Eneo Farms', 'review', 'farming'),
  row('Fahari Ltd', 'partner_approved'),
  row('Gem Co', 'report_issued'),
  row('Hema Co', 'locked'),
];

describe('filterEngagements', () => {
  test("'all' keeps every engagement", () => {
    expect(filterEngagements(rows, { group: 'all', query: '' })).toHaveLength(8);
  });
  test('a group keeps only its stages', () => {
    expect(filterEngagements(rows, { group: 'getting_ready', query: '' }).map((r) => r.clientName)).toEqual(['Acme Ltd', 'Baraka Foods']);
    expect(filterEngagements(rows, { group: 'finished', query: '' }).map((r) => r.clientName)).toEqual(['Fahari Ltd', 'Gem Co', 'Hema Co']);
  });
  test('search matches the client or the sector, ignoring case', () => {
    expect(filterEngagements(rows, { group: 'all', query: ' acme ' }).map((r) => r.clientName)).toEqual(['Acme Ltd']);
    expect(filterEngagements(rows, { group: 'all', query: 'FARMING' }).map((r) => r.clientName)).toEqual(['Baraka Foods', 'Eneo Farms']);
  });
  test('group and search combine', () => {
    expect(filterEngagements(rows, { group: 'in_review', query: 'farming' }).map((r) => r.clientName)).toEqual(['Eneo Farms']);
  });
});

describe('countByGroup', () => {
  test('counts every group and the total', () => {
    expect(countByGroup(rows)).toEqual({ all: 8, getting_ready: 2, fieldwork: 1, in_review: 2, finished: 3 });
  });
  test('every stage belongs to exactly one group', () => {
    const stages = STAGE_GROUPS.flatMap((g) => g.states);
    expect(new Set(stages).size).toBe(stages.length);
    expect(stages).toHaveLength(8);
  });
});
