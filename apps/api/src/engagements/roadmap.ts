import { ENGAGEMENT_STATES, type EngagementState } from './service';

export type RoadmapTab = 'overview' | 'papers' | 'evidence' | 'checklists' | 'financials';

export interface ChecklistFact {
  total: number;
  answered: number;
  mandatoryOpen: number;
}

export interface RoadmapFacts {
  state: EngagementState;
  /** Generated checklists by template id. A template that has not been generated is absent. */
  checklists: Record<string, ChecklistFact>;
  hasEngagementLetter: boolean;
  hasMateriality: boolean;
  hasRiskAssessment: boolean;
  hasMappedTb: boolean;
  openReviewNotes: number;
  awaitingSignoff: number;
}

export interface RoadmapStep {
  id: string;
  title: string;
  detail: string;
  status: 'done' | 'current' | 'todo';
  tab: RoadmapTab;
  action: string;
}

export interface Roadmap {
  steps: RoadmapStep[];
  next: RoadmapStep | null;
  percent: number;
}

type Draft = Omit<RoadmapStep, 'status'> & { done: boolean };

const at = (s: EngagementState) => ENGAGEMENT_STATES.indexOf(s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A step made of checklists plus optional extra requirements. Done only when every checklist exists, no mandatory
 * question is open, and every extra is met; the action names the first thing still missing.
 */
function checklistStep(
  facts: RoadmapFacts,
  base: { id: string; title: string; detail: string; templates: string[] },
  extras: { ok: boolean; tab: RoadmapTab; action: string }[] = [],
): Draft {
  const present = base.templates.filter((t) => facts.checklists[t]);
  const open = present.reduce((n, t) => n + facts.checklists[t]!.mandatoryOpen, 0);
  const missing = present.length < base.templates.length;
  const extra = extras.find((e) => !e.ok);
  const done = !missing && open === 0 && !extra;
  let tab: RoadmapTab = 'checklists';
  let action = 'Review';
  if (missing) action = 'Start the checklists';
  else if (open > 0) action = `Answer the ${plural(open, 'required question')}`;
  else if (extra) ({ tab, action } = extra);
  return { id: base.id, title: base.title, detail: base.detail, done, tab, action };
}

export function buildRoadmap(facts: RoadmapFacts): Roadmap {
  const sectorPacks = Object.keys(facts.checklists).filter((id) => id.startsWith('sector-'));
  const drafts: Draft[] = [
    checklistStep(facts, { id: 'loe', title: 'Accept the client and sign the engagement letter', detail: 'Acceptance checks, and the signed engagement letter on file.', templates: ['acceptance'] }, [
      { ok: facts.hasEngagementLetter, tab: 'papers', action: 'Record the signed engagement letter' },
    ]),
    checklistStep(facts, { id: 'preplanning', title: 'Pre-planning meeting', detail: 'The auditor and the manager agree the team, timetable, time budget and risk areas.', templates: ['preplanning-meeting'] }),
    checklistStep(facts, { id: 'client_meeting', title: 'Pre-audit meeting with the client', detail: 'Understand the operations, or what changed, and document the client systems.', templates: ['client-meeting', 'system-documentation'] }),
    checklistStep(facts, { id: 'planning', title: 'Plan the audit', detail: 'Materiality, risk assessment and how each risk will be addressed.', templates: ['planning', 'risk-assessment'] }, [
      { ok: facts.hasMateriality, tab: 'papers', action: 'Calculate materiality' },
      { ok: facts.hasRiskAssessment, tab: 'papers', action: 'Record the risk assessment' },
    ]),
    checklistStep(
      facts,
      {
        id: 'fieldwork', title: 'Fieldwork', detail: 'Laws and regulations, related parties, IT, journals, opening balances, going concern and the trial balance.',
        templates: ['fieldwork-core', 'laws-regulations', 'related-parties', 'it-environment', 'journals-trial-balance', 'opening-balances', 'going-concern', ...sectorPacks],
      },
      [{ ok: facts.hasMappedTb, tab: 'financials', action: 'Import and map the trial balance' }],
    ),
    checklistStep(facts, { id: 'completion', title: 'Complete the file', detail: 'Subsequent events, representations and the final review checks.', templates: ['completion'] }),
    {
      id: 'review', title: 'Review and approval',
      detail: `${plural(facts.openReviewNotes, 'open review note')}, ${plural(facts.awaitingSignoff, 'paper')} awaiting sign-off.`,
      done: at(facts.state) >= at('partner_approved'), tab: 'overview', action: 'Move the engagement through review',
    },
    { id: 'report', title: 'Issue the report', detail: 'Report date set and the report issued.', done: at(facts.state) >= at('report_issued'), tab: 'overview', action: 'Issue the report' },
  ];

  const firstOpen = drafts.findIndex((d) => !d.done);
  const steps: RoadmapStep[] = drafts.map(({ done, ...step }, i) => ({ ...step, status: done ? 'done' : i === firstOpen ? 'current' : 'todo' }));
  const doneCount = steps.filter((s) => s.status === 'done').length;
  return { steps, next: firstOpen < 0 ? null : steps[firstOpen]!, percent: Math.round((doneCount / steps.length) * 100) };
}
