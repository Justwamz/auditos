import ifrsSme2e from '@auditos/standards/content/disclosures/ifrs-sme-2e.json';
import ifrsSme3e from '@auditos/standards/content/disclosures/ifrs-sme-3e.json';
import type { FrameworkVersion } from './framework';
import type { Statements } from './statements';

interface DisclosureItem {
  id: string;
  ref: string;
  text: string;
  check?: 'sofp' | 'pl' | 'equity' | 'cashflow' | 'comparatives';
  noteId?: string;
}

const CHECKLISTS: Record<FrameworkVersion, DisclosureItem[]> = {
  IFRS_SME_2E: ifrsSme2e.items as DisclosureItem[],
  IFRS_SME_3E: ifrsSme3e.items as DisclosureItem[],
};

const satisfiedByData = (check: 'comparatives' | 'cashflow', s: Statements): boolean => (check === 'comparatives' ? s.hasComparatives : s.cashflow !== undefined);

export function disclosureChecklist(
  version: FrameworkVersion,
  s: Statements,
): { id: string; ref: string; text: string; satisfied: boolean; noteId?: string }[] {
  const noteIds = new Set(s.notes.map((n) => n.id));
  return CHECKLISTS[version].map((i) => {
    let satisfied = false;
    const explained = !s.hasComparatives && noteIds.has('no-comparatives');
    const needsExplanation = (i.check === 'comparatives' || i.check === 'cashflow') && !satisfiedByData(i.check, s);
    if (i.check === 'sofp') satisfied = s.sofp.sections.length > 0;
    else if (i.check === 'pl') satisfied = s.pl.rows.length > 0;
    else if (i.check === 'equity') satisfied = s.equity.rows.length > 0;
    else if (i.check === 'cashflow') satisfied = s.cashflow !== undefined || explained;
    else if (i.check === 'comparatives') satisfied = s.hasComparatives || explained;
    else if (i.noteId) satisfied = noteIds.has(i.noteId);
    const noteId = i.noteId ?? (needsExplanation ? 'no-comparatives' : undefined);
    return { id: i.id, ref: i.ref, text: i.text, satisfied, ...(noteId ? { noteId } : {}) };
  });
}
