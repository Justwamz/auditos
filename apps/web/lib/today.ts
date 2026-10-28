import { addDays, label } from './calendar';

export interface TodayRow { id: string; tone: 'action' | 'warn'; text: string; href: string }

export interface TodayInput {
  role: string;
  isAdmin: boolean;
  awaitingReview: { id: string; title: string; engagementId: string; clientName: string; level: string }[];
  myDrafts: { id: string; title: string; engagementId: string; clientName: string }[];
  openNotes: number;
  overdue?: { count: number; total: string };
  milestones: { date: string; title: string; engagementId: string }[];
  today: string;
}

const REVIEWERS = ['manager', 'partner', 'eqr'];
const WORKERS = ['partner', 'manager', 'senior', 'staff'];
/** How far ahead dates still count as "coming up". */
const LOOKAHEAD_DAYS = 14;

/** The things that need this person today, plain words, action rows first and then warnings. */
export function buildToday(input: TodayInput): TodayRow[] {
  if (input.role === 'firm_admin') return [];
  const action: TodayRow[] = [];
  const warn: TodayRow[] = [];

  if (REVIEWERS.includes(input.role)) {
    for (const p of input.awaitingReview) {
      const need = p.level === 'manager' ? 'needs your review' : 'needs your approval';
      action.push({ id: `review-${p.id}`, tone: 'action', text: `${p.title} for ${p.clientName} ${need}`, href: `/engagements/${p.engagementId}?tab=papers&item=${p.id}` });
    }
  }
  if (WORKERS.includes(input.role)) {
    for (const p of input.myDrafts) {
      action.push({ id: `draft-${p.id}`, tone: 'action', text: `Finish your draft ${p.title} for ${p.clientName}`, href: `/engagements/${p.engagementId}?tab=papers&item=${p.id}` });
    }
    if (input.openNotes > 0) {
      warn.push({
        id: 'notes',
        tone: 'warn',
        text: `${input.openNotes} open review ${input.openNotes === 1 ? 'note is' : 'notes are'} waiting across your engagements`,
        href: '/engagements',
      });
    }
  }
  if (input.overdue && input.overdue.count > 0) {
    const n = input.overdue.count;
    warn.push({ id: 'overdue', tone: 'warn', text: `${n} ${n === 1 ? 'invoice is' : 'invoices are'} overdue (${input.overdue.total})`, href: '/invoices' });
  }
  const last = addDays(input.today, LOOKAHEAD_DAYS);
  for (const m of input.milestones) {
    if (m.date < input.today || m.date > last) continue;
    warn.push({ id: `milestone-${m.engagementId}-${m.date}-${m.title}`, tone: 'warn', text: `${m.title}, ${label(m.date)}`, href: `/engagements/${m.engagementId}` });
  }
  return [...action, ...warn];
}
