export interface MilestoneSource {
  id: string;
  clientName: string;
  periodEnd: string;
  reportDate: string | null;
  state: string;
}

export interface Milestone {
  date: string;
  title: string;
  engagementId: string;
  clientName: string;
  kind: 'year_end' | 'report_date' | 'lock_deadline';
}

/** Days after the report date by which the file must be assembled and locked. */
export const LOCK_DEADLINE_DAYS = 60;

/** Adds days to a YYYY-MM-DD date without involving a time zone. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dates the firm cares about on each engagement: year end, report date, and the deadline to lock the file. */
export function milestonesFor(engagements: MilestoneSource[], from: string, to: string): Milestone[] {
  const out: Milestone[] = [];
  for (const e of engagements) {
    const add = (date: string, title: string, kind: Milestone['kind']) => {
      if (date >= from && date <= to) out.push({ date, title: `${title}: ${e.clientName}`, engagementId: e.id, clientName: e.clientName, kind });
    };
    add(e.periodEnd, 'Year end', 'year_end');
    if (e.reportDate) {
      add(e.reportDate, 'Report date', 'report_date');
      if (e.state !== 'locked') add(addDays(e.reportDate, LOCK_DEADLINE_DAYS), 'File must be locked', 'lock_deadline');
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
