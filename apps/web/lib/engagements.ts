import { SECTOR_LABELS } from './text';

/** The eight engagement stages, gathered into four plain groups for the filter chips. */
export const STAGE_GROUPS = [
  { id: 'getting_ready', label: 'Getting ready', states: ['onboarding', 'planning'] },
  { id: 'fieldwork', label: 'Fieldwork', states: ['fieldwork'] },
  { id: 'in_review', label: 'In review', states: ['completion', 'review'] },
  { id: 'finished', label: 'Finished', states: ['partner_approved', 'report_issued', 'locked'] },
] as const;

export type StageGroup = 'all' | (typeof STAGE_GROUPS)[number]['id'];

export interface EngagementFilter {
  group: StageGroup;
  query: string;
}

export function filterEngagements<E extends { clientName: string; state: string; sector: string }>(rows: E[], f: EngagementFilter): E[] {
  const states: readonly string[] | undefined = f.group === 'all' ? undefined : STAGE_GROUPS.find((g) => g.id === f.group)?.states;
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (states && !states.includes(r.state)) return false;
    if (q === '') return true;
    return [r.clientName, r.sector, SECTOR_LABELS[r.sector] ?? ''].some((s) => s.toLowerCase().includes(q));
  });
}

export function countByGroup(rows: { state: string }[]): Record<StageGroup, number> {
  const out = { all: rows.length, getting_ready: 0, fieldwork: 0, in_review: 0, finished: 0 } as Record<StageGroup, number>;
  for (const r of rows) {
    const g = STAGE_GROUPS.find((x) => (x.states as readonly string[]).includes(r.state));
    if (g) out[g.id] += 1;
  }
  return out;
}
