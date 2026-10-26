export type Sector = 'trading' | 'consultancy' | 'rental' | 'farming' | 'pension' | 'investment';
export type Framework = 'IFRS_SME' | 'FULL_IFRS';
export type Phase = 'acceptance' | 'planning' | 'fieldwork' | 'completion';

export interface Condition {
  sector?: Sector[];
  riskFlag?: string;
  framework?: Framework;
}

export interface ChecklistItem {
  id: string;
  ref: string;
  question: string;
  mandatory: boolean;
  when?: Condition;
  standardRefs: string[];
}

export interface Template {
  id: string;
  title: string;
  phase: Phase;
  version: number;
  status: 'unreviewed-placeholder' | 'reviewed';
  effectiveFrom: string;
  applies?: Condition;
  items: ChecklistItem[];
}

export interface Profile {
  sector: Sector;
  framework: Framework;
  riskFlags: string[];
}

export interface GeneratedChecklist {
  templateId: string;
  templateVersion: number;
  title: string;
  phase: Phase;
  items: ChecklistItem[];
}
