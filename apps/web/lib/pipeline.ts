export type Stage = 'lead' | 'proposal' | 'loe_sent' | 'won' | 'lost';

export interface ProspectFilter {
  stage: 'open' | Stage;
  ownerId: string;
  query: string;
}

export const STAGE_LABELS: Record<Stage, string> = {
  lead: 'Lead',
  proposal: 'Proposal sent',
  loe_sent: 'Engagement letter sent',
  won: 'Won',
  lost: 'Lost',
};

export const OPEN_STAGES: readonly Stage[] = ['lead', 'proposal', 'loe_sent'];

export function filterProspects<
  P extends { name: string; ownerId: string; ownerName: string; stage: Stage; contactName: string | null },
>(rows: P[], f: ProspectFilter): P[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.stage === 'open' ? !OPEN_STAGES.includes(r.stage) : r.stage !== f.stage) return false;
    if (f.ownerId !== '' && r.ownerId !== f.ownerId) return false;
    if (q === '') return true;
    return [r.name, r.ownerName, r.contactName ?? ''].some((s) => s.toLowerCase().includes(q));
  });
}

export function countByStage(rows: { stage: Stage }[]): Record<Stage, number> {
  const counts: Record<Stage, number> = { lead: 0, proposal: 0, loe_sent: 0, won: 0, lost: 0 };
  for (const r of rows) counts[r.stage] += 1;
  return counts;
}

export interface Prospect {
  id: string;
  name: string;
  sector: string | null;
  contactName: string | null;
  source: string | null;
  ownerId: string;
  ownerName: string;
  stage: Stage;
  expectedFee: string | null;
  expectedStart: string | null;
  notes: string | null;
  lostReason: string | null;
  clientId: string | null;
}

export interface ProspectActions {
  move: (p: Prospect, stage: Stage) => void;
  lose: (p: Prospect) => void;
  handOver: (p: Prospect) => void;
  convert: (p: Prospect) => void;
}


export const kes = (v: string | null): string =>
  v === null ? 'No fee yet' : `KES ${Number(v).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
