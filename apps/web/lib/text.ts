import { ApiError } from './api';

export const STATE_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  planning: 'Planning',
  fieldwork: 'Fieldwork',
  completion: 'Completion',
  review: 'Review',
  partner_approved: 'Partner approved',
  report_issued: 'Report issued',
  locked: 'Locked',
  draft: 'Draft',
  prepared: 'Prepared',
  manager_reviewed: 'Manager reviewed',
  open: 'Open',
  cleared: 'Cleared',
  accepted: 'Accepted',
};
export const STAGES = ['onboarding', 'planning', 'fieldwork', 'completion', 'review', 'partner_approved', 'report_issued', 'locked'] as const;

export const ROLE_LABELS: Record<string, string> = {
  firm_admin: 'Firm administrator',
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  staff: 'Staff',
  quality_officer: 'Quality officer',
  eqr: 'Engagement quality reviewer',
};

export const SECTOR_LABELS: Record<string, string> = {
  trading: 'Trading', consultancy: 'Consultancy', rental: 'Rental', farming: 'Farming', pension: 'Pension scheme', investment: 'Investment',
};

export const GATE_LABELS: Record<string, string> = {
  acceptanceApproved: 'The client acceptance paper needs partner approval.',
  engagementLetterOnFile: 'Add an engagement letter paper.',
  independenceCurrent: 'Everyone on the team needs a current independence declaration.',
  materialityApproved: 'The materiality paper needs manager and partner approval.',
  riskAssessmentApproved: 'The risk assessment paper needs manager and partner approval.',
  mandatoryChecklistComplete: 'Generate the checklists and answer every mandatory question.',
  reviewNotesCleared: 'Clear or accept all open review notes.',
  trialBalanceMappedAndBalanced: 'Import a balanced trial balance and map every account.',
  disclosureChecklistComplete: 'Complete every item on the disclosure checklist.',
  eqrSignedOffWhereRequired: 'The engagement quality review needs final sign-off.',
};

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'The email or password is wrong, or the account is temporarily locked.',
  unauthenticated: 'Your session has ended. Sign in again.',
  forbidden: 'Your role cannot do that here.',
  not_found: 'That could not be found, or you are not on the engagement.',
  stale_content: 'This paper changed after you opened it. Reload and review the latest version before signing.',
  open_review_notes: 'Open review notes must be cleared or accepted before partner approval.',
  gate_blocked: 'This engagement cannot move on yet.',
  invalid_transition: 'The engagement has to go through each stage in order.',
  independence_declaration_required: 'That person needs a current independence declaration first.',
  reason_required: 'Give a reason of at least five characters.',
  rationale_required: 'Add a rationale for No or N/A answers.',
  engagement_not_locked: 'The engagement is not locked.',
  request_already_pending: 'There is already a pending request.',
  cannot_modify_self: 'You cannot change your own access.',
  framework_not_supported: 'Full IFRS statements are not supported yet. Use IFRS for SMEs.',
  statements_blocked: 'Fix the blockers on the statements first.',
  invalid_file: 'That file was rejected.',
  quarantined: 'That file failed the malware scan and cannot be downloaded.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  csrf: 'Your session needs refreshing. Reload the page.',
  entry_unbalanced: 'Debits and credits must be equal.',
  unknown_account: 'One of the accounts is not in the trial balance.',
  invalid_amount: 'Each line needs a debit or a credit, not both and not neither.',
  partner_required: 'Only a partner can do that.',
  cannot_approve_own_request: 'Someone else has to approve your request.',
  code_already_used: 'That code was already used. Wait for the next one.',
  invalid_rows: 'The file has problems. See the rows listed below.',
  missing_columns: 'The file needs the columns: code, name, debit, credit.',
  too_many_rows: 'The file has more than 5,000 rows.',
  item_deleted: 'That paper was deleted.',
  evidence_immutable: 'Evidence cannot be edited. Upload a new file instead.',
};

export function explain(err: unknown): string {
  if (err instanceof ApiError) {
    const raw = err.body.reason;
    if (typeof raw === 'string' && err.code === 'invalid_file') return raw;
    return MESSAGES[err.code] ?? `Something went wrong (${err.code}).`;
  }
  return 'Something went wrong. Check your connection and try again.';
}

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const initialsOf = (email: string): string => {
  const parts = email.split('@')[0]!.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts.map((p) => p[0]).join('') : (parts[0] ?? '?').slice(0, 2);
  return letters.slice(0, 3).toUpperCase();
};

/** Cents as a string (statements) to 1,234.50 with brackets for negatives. */
export const fmtCents = (cents: string | number | bigint | undefined | null): string => {
  if (cents === undefined || cents === null || cents === '') return '';
  const v = BigInt(cents);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = `${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
  return neg ? `(${s})` : s;
};
