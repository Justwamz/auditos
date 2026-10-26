import { describe, expect, test } from 'vitest';
import { mapTrialBalance } from '../src/mapping';
import { buildStatements } from '../src/statements';
import { disclosureChecklist } from '../src/disclosures';
import { resolveFramework } from '../src/framework';
import { trading } from './fixtures';

const build = (start: string, end: string) => {
  const r = buildStatements(mapTrialBalance(trading.tb, trading.mapping), { periodStart: start, periodEnd: end, framework: 'IFRS_SME' });
  if (!r.ok) throw new Error('blocked');
  return r.statements;
};

describe('disclosure checklist', () => {
  test('3E checklist differs from 2E and is chosen via resolveFramework', () => {
    const s2 = build('2026-01-01', '2026-12-31');
    const s3 = build('2027-01-01', '2027-12-31');
    const c2 = disclosureChecklist(resolveFramework('IFRS_SME', '2026-01-01'), s2);
    const c3 = disclosureChecklist(resolveFramework('IFRS_SME', '2027-01-01'), s3);
    expect(c2.map((i) => i.id)).not.toEqual(c3.map((i) => i.id));
    expect(c2.length).toBeGreaterThan(5);
  });
  test('missing comparatives is shown as unsatisfied', () => {
    const c = disclosureChecklist('IFRS_SME_2E', build('2026-01-01', '2026-12-31'));
    expect(c.find((i) => i.id === 'comparatives')?.satisfied).toBe(false);
  });
  test('generated notes satisfy their disclosure items', () => {
    const c = disclosureChecklist('IFRS_SME_2E', build('2026-01-01', '2026-12-31'));
    expect(c.find((i) => i.id === 'revenue-note')?.satisfied).toBe(true);
    expect(c.find((i) => i.id === 'related-parties')?.satisfied).toBe(false);
  });
});

describe('disclosure items expose the note they need', () => {
  test('items that depend on a note carry its id so the UI can ask for it', () => {
    const c = disclosureChecklist('IFRS_SME_2E', build('2026-01-01', '2026-12-31'));
    expect(c.find((i) => i.id === 'related-parties')?.noteId).toBe('related-parties');
    expect(c.find((i) => i.id === 'basis-of-preparation')?.noteId).toBe('policies');
    expect(c.find((i) => i.id === 'sofp')?.noteId).toBeUndefined();
  });
});
