export interface AuditRow {
  action: string;
  entityType: string;
  actorName: string | null;
  detail: Record<string, unknown>;
  clientName: string | null;
  /** For events about a paper's sign-off or evidence: the paper they refer to. */
  itemTitle: string | null;
  itemKind: string | null;
}

const KIND_LABELS: Record<string, string> = {
  acceptance: 'client acceptance form',
  engagement_letter: 'engagement letter',
  materiality: 'materiality paper',
  risk_assessment: 'risk assessment',
  workpaper: 'working paper',
  eqr_review: 'quality review',
  addendum: 'addendum',
  checklist: 'checklist',
  evidence: 'evidence file',
  trial_balance: 'trial balance',
  trial_balance_prior: 'prior-year trial balance',
  fs_mapping: 'statement mapping',
  adjustments: 'adjustments schedule',
  fs_note: 'financial statement note',
};
const STATE_LABELS: Record<string, string> = {
  draft: 'draft',
  prepared: 'prepared',
  manager_reviewed: 'reviewed by the manager',
  partner_approved: 'approved by the partner',
  locked: 'locked',
};
const FIELD_LABELS: Record<string, string> = { phone: 'phone number', email: 'email address', idNumber: 'ID number', kraPin: 'KRA PIN' };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const kindLabel = (kind: string | null | undefined) => KIND_LABELS[kind ?? ''] ?? 'document';

/** One plain-English sentence for an audit event. No timestamp: the caller shows that separately. */
export function describeEvent(e: AuditRow): string {
  const who = e.actorName ?? 'The system';
  const forClient = e.clientName ? ` for ${e.clientName}` : '';
  const d = e.detail;
  const paper = (kind: string, title: string) => `the ${kindLabel(kind)} "${title}"${forClient}`;

  switch (e.action) {
    case 'view.paper':
      return `${who} viewed ${paper(str(d.kind), str(d.label))}`;
    case 'view.client':
      return `${who} viewed the client file of ${e.clientName ?? str(d.label)}`;
    case 'view.engagement':
      return `${who} opened the audit file${forClient}`;
    case 'view.statements':
      return `${who} viewed the draft financial statements${forClient}`;
    case 'pii.revealed': {
      const field = FIELD_LABELS[str(d.field)] ?? 'personal detail';
      const at = e.clientName ? ` at ${e.clientName}` : '';
      return `${who} revealed the ${field} of ${str(d.contactName) || 'a contact'}${at}. Reason given: "${str(d.reason)}"`;
    }
    case 'item.created':
      return `${who} created ${paper(str(d.kind), str(d.title))}`;
    case 'item.edited': {
      const reason = str(d.reason) ? `. Reason given: "${str(d.reason)}"` : '';
      return `${who} edited ${paper(str(d.kind), str(d.title))} (now version ${String(d.version)})${reason}`;
    }
    case 'item.deleted':
      return `${who} deleted ${paper(str(d.kind), str(d.title))}`;
    case 'item.state_changed':
      return `${who} moved ${paper(str(d.kind), str(d.title))} from ${STATE_LABELS[str(d.previous_state)] ?? str(d.previous_state)} to ${STATE_LABELS[str(d.state)] ?? str(d.state)}`;
    case 'evidence.downloaded':
      return `${who} downloaded the evidence file "${e.itemTitle ?? ''}"${forClient}`;
    case 'export.created':
      return `${who} exported the ${d.draft ? 'draft ' : ''}financial statements as ${str(d.format).toUpperCase()}${forClient}`;
    case 'prospect.created':
      return `${who} added the prospect ${str(d.prospectName)}, owned by ${str(d.ownerName)}`;
    case 'prospect.edited':
      return `${who} edited the details of the prospect ${str(d.prospectName)}`;
    case 'prospect.stage_changed': {
      const reason = str(d.reason) ? `. Reason given: "${str(d.reason)}"` : '';
      return `${who} moved the prospect ${str(d.prospectName)} from ${str(d.from)} to ${str(d.to)}${reason}`;
    }
    case 'prospect.reassigned':
      return `${who} handed the prospect ${str(d.prospectName)} from ${str(d.from)} to ${str(d.to)}. Reason given: "${str(d.reason)}"`;
    case 'prospect.won':
      return `${who} converted the prospect ${str(d.prospectName)} into a client`;
    case 'client.manager_changed':
      return `${who} changed the account manager of ${str(d.clientName)} from ${str(d.from)} to ${str(d.to)}. Reason given: "${str(d.reason)}"`;
    case 'member.handed_over': {
      const n = (v: unknown, one: string, many: string) => `${String(v)} ${v === 1 ? one : many}`;
      return `${who} handed over ${n(d.clients, 'client', 'clients')} and ${n(d.prospects, 'prospect', 'prospects')} from ${str(d.from)} to ${str(d.to)}. Reason given: "${str(d.reason)}"`;
    }
    case 'calendar.scheduled':
      return `${who} scheduled the ${str(d.kind)} "${str(d.title)}"${forClient}`;
    case 'calendar.changed':
      return `${who} changed the ${str(d.kind)} "${str(d.title)}"${forClient}`;
    case 'calendar.cancelled':
      return `${who} cancelled the ${str(d.kind)} "${str(d.title)}"${forClient}`;
    case 'auth.login':
      return `${who} signed in`;
    case 'auth.logout':
      return `${who} signed out`;
    case 'auth.tenant_selected':
      return `${who} chose their firm after signing in`;
    case 'engagement.unlocked':
      return `${who} unlocked the file${forClient}`;
    case 'engagement.auto_locked':
      return `${who} locked the file${forClient} after the 60-day deadline`;
  }

  if (e.entityType === 'signoffs') {
    const item = paper(e.itemKind ?? '', e.itemTitle ?? '');
    if (e.action === 'INSERT') return `${who} signed off ${item} as ${str(d.level)}`;
    const next = d.new as Record<string, unknown> | undefined;
    const prev = d.old as Record<string, unknown> | undefined;
    if (e.action === 'UPDATE' && next?.revoked_at && !prev?.revoked_at) return `A ${str(next.level)} sign-off on ${item} was removed because the paper changed`;
  }
  if (e.entityType === 'engagement_members' && e.action === 'INSERT') return `${who} added a team member`;
  if (e.entityType === 'engagements' && e.action === 'INSERT') return `${who} opened a new engagement${forClient}`;
  if (e.entityType === 'clients' && e.action === 'INSERT') return `${who} added the client ${str(d.name)}`;
  if (e.entityType === 'review_notes' && e.action === 'INSERT') return `${who} raised a review note${forClient}`;
  return `${who} made a change (${e.action} on ${e.entityType})`;
}
