import { describe, expect, test } from 'vitest';
import { generateChecklists, loadTemplates, type Profile } from '../src';

const templates = loadTemplates();
const base: Omit<Profile, 'sector'> = { framework: 'IFRS_SME', riskFlags: [] };
const gen = (p: Profile) => generateChecklists(p, templates);
const questions = (p: Profile) => gen(p).checklists.flatMap((c) => c.items.map((i) => i.question.toLowerCase()));
const has = (qs: string[], needle: string) => qs.some((q) => q.includes(needle));

describe('generateChecklists', () => {
  test('rental profile includes investment property items', () => {
    expect(has(questions({ ...base, sector: 'rental' }), 'investment property')).toBe(true);
    expect(has(questions({ ...base, sector: 'trading' }), 'investment property')).toBe(false);
  });
  test('trading includes inventory counts', () => {
    expect(has(questions({ ...base, sector: 'trading' }), 'inventory count')).toBe(true);
  });
  test('consultancy includes WIP and revenue recognition', () => {
    const qs = questions({ ...base, sector: 'consultancy' });
    expect(has(qs, 'work in progress')).toBe(true);
    expect(has(qs, 'revenue')).toBe(true);
  });
  test('farming profile yields core items only and a sector-pack-not-available notice', () => {
    const r = gen({ ...base, sector: 'farming' });
    expect(r.checklists.length).toBeGreaterThan(3);
    expect(r.checklists.some((c) => c.templateId.startsWith('sector-'))).toBe(false);
    expect(r.notices.join(' ')).toMatch(/sector pack not available/i);
  });
  test('fraud risk flag adds extra items', () => {
    const plain = gen({ ...base, sector: 'trading' }).checklists.flatMap((c) => c.items).length;
    const flagged = gen({ ...base, sector: 'trading', riskFlags: ['fraud'] }).checklists.flatMap((c) => c.items).length;
    expect(flagged).toBeGreaterThan(plain);
  });
  test('generation is deterministic', () => {
    const p: Profile = { ...base, sector: 'rental', riskFlags: ['fraud'] };
    expect(JSON.stringify(gen(p))).toBe(JSON.stringify(gen(p)));
  });
});

describe('template content guards', () => {
  const items = templates.flatMap((t) => t.items.map((i) => ({ t, i })));
  test('every item carries at least one standardRef and a bounded question length', () => {
    for (const { i } of items) {
      expect(i.standardRefs.length, i.id).toBeGreaterThan(0);
      expect(i.question.length, i.id).toBeLessThanOrEqual(400);
    }
  });
  test('all templates are labelled unreviewed placeholders', () => {
    for (const t of templates) expect(t.status).toBe('unreviewed-placeholder');
  });
  test('item ids are unique across all templates', () => {
    const ids = items.map(({ i }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('core coverage topics exist', () => {
    const text = items.map(({ i }) => i.question.toLowerCase()).join(' ');
    for (const topic of ['independence', 'materiality', 'fraud', 'going concern', 'related part', 'laws and regulations', 'receivable', 'payable', 'bank', 'payroll', 'subsequent events', 'representation']) {
      expect(text, topic).toContain(topic);
    }
  });
  test('every template pins a version and effective date', () => {
    for (const t of templates) {
      expect(t.version).toBeGreaterThan(0);
      expect(t.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
