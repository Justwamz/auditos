import { describe, expect, test } from 'vitest';
import { countByStage, filterProspects, STAGE_LABELS, type Stage } from '../lib/pipeline';

function row(name: string, ownerId: string, ownerName: string, stage: Stage, contactName: string | null = null) {
  return { name, ownerId, ownerName, stage, contactName };
}

const rows = [
  row('Acme Ltd', 'u1', 'Daniel Kamau', 'lead', 'Josephine Wanjiru'),
  row('Baraka Foods', 'u2', 'Grace Achieng', 'proposal'),
  row('Cheche Co', 'u1', 'Daniel Kamau', 'loe_sent', 'Peter Otieno'),
  row('Dunia Traders', 'u2', 'Grace Achieng', 'won'),
  row('Eneo Farms', 'u1', 'Daniel Kamau', 'lost'),
];
const all = { stage: 'open' as const, ownerId: '', query: '' };

describe('filterProspects', () => {
  test("'open' excludes won and lost", () => {
    expect(filterProspects(rows, all).map((r) => r.stage)).toEqual(['lead', 'proposal', 'loe_sent']);
  });
  test('a stage filter returns only that stage', () => {
    const out = filterProspects(rows, { ...all, stage: 'proposal' });
    expect(out.map((r) => r.name)).toEqual(['Baraka Foods']);
  });
  test('owner filter', () => {
    const out = filterProspects(rows, { ...all, stage: 'lost', ownerId: 'u1' });
    expect(out.map((r) => r.name)).toEqual(['Eneo Farms']);
    expect(filterProspects(rows, { ...all, ownerId: 'u2' }).map((r) => r.name)).toEqual(['Baraka Foods']);
  });
  test('query matches owner name and contact name, ignoring case and surrounding spaces', () => {
    expect(filterProspects(rows, { ...all, query: '  DANIEL ' }).map((r) => r.name)).toEqual(['Acme Ltd', 'Cheche Co']);
    expect(filterProspects(rows, { ...all, query: 'josephine' }).map((r) => r.name)).toEqual(['Acme Ltd']);
    expect(filterProspects(rows, { ...all, query: 'baraka' }).map((r) => r.name)).toEqual(['Baraka Foods']);
  });
  test('empty query and no owner return all of the stage', () => {
    expect(filterProspects(rows, { ...all, stage: 'won', query: '   ' })).toHaveLength(1);
    expect(filterProspects(rows, all)).toHaveLength(3);
  });
  test('no match returns an empty list', () => {
    expect(filterProspects(rows, { ...all, query: 'zzz' })).toEqual([]);
  });
});

describe('countByStage', () => {
  test('counts each stage, zeros included', () => {
    expect(countByStage(rows)).toEqual({ lead: 1, proposal: 1, loe_sent: 1, won: 1, lost: 1 });
    expect(countByStage([rows[0]!, rows[1]!, rows[1]!])).toEqual({ lead: 1, proposal: 2, loe_sent: 0, won: 0, lost: 0 });
    expect(countByStage([])).toEqual({ lead: 0, proposal: 0, loe_sent: 0, won: 0, lost: 0 });
  });
});

describe('STAGE_LABELS', () => {
  test('plain words', () => {
    expect(STAGE_LABELS).toEqual({
      lead: 'Lead',
      proposal: 'Proposal sent',
      loe_sent: 'Engagement letter sent',
      won: 'Won',
      lost: 'Lost',
    });
  });
});
