import { describe, expect, test } from 'vitest';
import { buildRoadmap, type RoadmapFacts } from '../src/engagements/roadmap';

const ALL = [
  'acceptance', 'preplanning-meeting', 'client-meeting', 'system-documentation', 'planning', 'risk-assessment',
  'fieldwork-core', 'laws-regulations', 'related-parties', 'it-environment', 'journals-trial-balance', 'opening-balances',
  'going-concern', 'completion',
];
const done = { total: 5, answered: 5, mandatoryOpen: 0 };
const facts = (over: Partial<RoadmapFacts> = {}, checklists: RoadmapFacts['checklists'] = Object.fromEntries(ALL.map((id) => [id, done]))): RoadmapFacts => ({
  state: 'onboarding', checklists, hasEngagementLetter: true, hasMateriality: true, hasRiskAssessment: true, hasMappedTb: true,
  openReviewNotes: 0, awaitingSignoff: 0, ...over,
});

describe('buildRoadmap', () => {
  test('nothing generated yet: the first step is current and tells the user to start the checklists', () => {
    const r = buildRoadmap(facts({ hasEngagementLetter: false }, {}));
    expect(r.steps[0]).toMatchObject({ id: 'loe', status: 'current', tab: 'checklists', action: 'Start the checklists' });
    expect(r.steps.slice(1).every((s) => s.status === 'todo')).toBe(true);
    expect(r.next?.id).toBe('loe');
    expect(r.percent).toBe(0);
  });

  test('checklist answered but no engagement letter: the step stays open and asks for the letter', () => {
    const r = buildRoadmap(facts({ hasEngagementLetter: false }));
    expect(r.steps[0]).toMatchObject({ id: 'loe', status: 'current', tab: 'papers' });
    expect(r.steps[0]!.action).toMatch(/engagement letter/i);
  });

  test('a mandatory question left open keeps the step current and says how many', () => {
    const lists = Object.fromEntries(ALL.map((id) => [id, done])) as RoadmapFacts['checklists'];
    lists['preplanning-meeting'] = { total: 7, answered: 4, mandatoryOpen: 2 };
    const r = buildRoadmap(facts({}, lists));
    expect(r.steps.find((s) => s.id === 'loe')!.status).toBe('done');
    const pre = r.steps.find((s) => s.id === 'preplanning')!;
    expect(pre.status).toBe('current');
    expect(pre.action).toMatch(/2 required/);
    expect(r.next?.id).toBe('preplanning');
  });

  test('planning needs materiality and a risk assessment as well as the checklists', () => {
    const r = buildRoadmap(facts({ hasMateriality: false }));
    const planning = r.steps.find((s) => s.id === 'planning')!;
    expect(planning.status).toBe('current');
    expect(planning.action).toMatch(/materiality/i);
  });

  test('fieldwork includes any sector checklist that was generated and the mapped trial balance', () => {
    const lists = { ...Object.fromEntries(ALL.map((id) => [id, done])), 'sector-trading': { total: 6, answered: 3, mandatoryOpen: 3 } } as RoadmapFacts['checklists'];
    expect(buildRoadmap(facts({}, lists)).steps.find((s) => s.id === 'fieldwork')!.status).toBe('current');
    expect(buildRoadmap(facts({ hasMappedTb: false })).steps.find((s) => s.id === 'fieldwork')!.tab).toBe('financials');
  });

  test('review and report follow the engagement stage; review notes are shown but do not decide it', () => {
    const r = buildRoadmap(facts({ state: 'review', openReviewNotes: 3, awaitingSignoff: 2 }));
    const review = r.steps.find((s) => s.id === 'review')!;
    expect(review.status).toBe('current');
    expect(review.detail).toMatch(/3 open review notes/);
    expect(review.detail).toMatch(/2 .*awaiting/);
  });

  test('a finished engagement is 100% with no next step', () => {
    const r = buildRoadmap(facts({ state: 'report_issued' }));
    expect(r.percent).toBe(100);
    expect(r.next).toBeNull();
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);
  });

  test('percent is the share of steps done and never reports a step done with a mandatory item open', () => {
    const lists = Object.fromEntries(ALL.map((id) => [id, done])) as RoadmapFacts['checklists'];
    lists['acceptance'] = { total: 7, answered: 6, mandatoryOpen: 1 };
    const r = buildRoadmap(facts({}, lists));
    expect(r.steps[0]!.status).toBe('current');
    expect(r.percent).toBeLessThan(100);
    expect(r.steps.filter((s) => s.status === 'done').length / r.steps.length).toBeCloseTo(r.percent / 100, 1);
  });
});
