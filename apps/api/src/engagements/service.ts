import type { Pool, PoolClient } from 'pg';

export const ENGAGEMENT_STATES = [
  'onboarding', 'planning', 'fieldwork', 'completion', 'review', 'partner_approved', 'report_issued', 'locked',
] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];

export const nextState = (s: EngagementState): EngagementState | null => ENGAGEMENT_STATES[ENGAGEMENT_STATES.indexOf(s) + 1] ?? null;

export interface EngagementRow {
  id: string;
  tenant_id: string;
  client_id: string;
  client_name: string;
  sector: string;
  framework: string;
  period_start: string;
  period_end: string;
  state: EngagementState;
  partner_id: string;
  eqr_id: string | null;
  report_date: string | null;
  locked_at: Date | null;
  risk_profile: { riskFlags?: string[] };
  /** On the engagement team. A partner who is not can read the file but not change it. */
  member: boolean;
}

const SELECT = `select e.id, e.tenant_id, e.client_id, c.name as client_name, c.sector, c.framework,
       to_char(e.period_start, 'YYYY-MM-DD') as period_start, to_char(e.period_end, 'YYYY-MM-DD') as period_end,
       e.state, e.partner_id, e.eqr_id, to_char(e.report_date, 'YYYY-MM-DD') as report_date, e.locked_at, e.risk_profile,
       is_engagement_member(e.id) as member
  from engagements e join clients c on c.id = e.client_id`;

/** Visible only to members (row-level security); undefined means "not found". */
export async function loadEngagement(tx: PoolClient, id: string): Promise<EngagementRow | undefined> {
  return (await tx.query(`${SELECT} where e.id = $1`, [id])).rows[0] as EngagementRow | undefined;
}

export async function listEngagements(tx: PoolClient): Promise<EngagementRow[]> {
  return (await tx.query(`${SELECT} order by e.period_end desc, c.name`)).rows as EngagementRow[];
}

/** System job. Locks report_issued engagements past their assembly deadline in every tenant. */
export async function lockDueEngagements(pool: Pool, today: Date): Promise<number> {
  // Two runs at once (a restart overlapping the hourly job) can deadlock on the per-firm audit locks; the loser just runs again.
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await pool.query('select system_lock_due($1::date) as n', [today.toISOString().slice(0, 10)]);
      return r.rows[0].n as number;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if ((code !== '40P01' && code !== '40001') || attempt >= 3) throw e;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}
