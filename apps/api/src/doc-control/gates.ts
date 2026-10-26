import type { PoolClient } from 'pg';
import { registerGate } from '../engagements/gates';

const hasItem = async (tx: PoolClient, engagementId: string, kind: string, approvedOnly: boolean): Promise<boolean> => {
  const r = await tx.query(
    `select 1 from wp_items where engagement_id = $1 and kind = $2 and deleted_at is null
       ${approvedOnly ? "and state = 'partner_approved'" : ''} limit 1`,
    [engagementId, kind],
  );
  return (r.rowCount ?? 0) > 0;
};

/** Gates that depend on working paper items and independence. Other modules register their own. */
export function registerDocControlGates(): void {
  registerGate('onboarding', 'planning', {
    gate: 'acceptanceApproved',
    message: 'The client acceptance paper must be approved by the partner',
    run: (tx, id) => hasItem(tx, id, 'acceptance', true),
  });
  registerGate('onboarding', 'planning', {
    gate: 'engagementLetterOnFile',
    message: 'An engagement letter must be on file',
    run: (tx, id) => hasItem(tx, id, 'engagement_letter', false),
  });
  registerGate('onboarding', 'planning', {
    gate: 'independenceCurrent',
    message: 'Every team member needs a current independence declaration',
    run: async (tx, id) => {
      const r = await tx.query(
        'select not exists (select 1 from engagement_members em where em.engagement_id = $1 and not has_independence(em.user_id, em.engagement_id)) as ok',
        [id],
      );
      return r.rows[0].ok === true;
    },
  });
  registerGate('planning', 'fieldwork', {
    gate: 'materialityApproved',
    message: 'Materiality must be approved by the manager and partner',
    run: (tx, id) => hasItem(tx, id, 'materiality', true),
  });
  registerGate('planning', 'fieldwork', {
    gate: 'riskAssessmentApproved',
    message: 'The risk assessment must be approved by the manager and partner',
    run: (tx, id) => hasItem(tx, id, 'risk_assessment', true),
  });
}
