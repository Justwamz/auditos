import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { appendEvent } from '@auditos/audit-log';
import { actorOf } from '../authz';

export type ViewType = 'client' | 'engagement' | 'paper' | 'statements' | 'statement' | 'sampling';

export interface ViewTarget {
  type: ViewType;
  /** Id of the thing viewed (client, engagement or paper). */
  id: string;
  /** Name shown in the sentence, kept as it was when viewed. */
  label: string;
  clientName?: string | null;
  engagementId?: string | null;
  kind?: string;
}

const WINDOW = '5 minutes';

/**
 * Records that the signed-in person looked at something. Looking at the same thing again within five minutes
 * is not logged again, so the trail stays readable. Runs inside the request's tenant transaction.
 */
export async function recordView(req: FastifyRequest, tx: PoolClient, target: ViewTarget): Promise<void> {
  const actor = actorOf(req);
  const action = `view.${target.type}`;
  const recent = await tx.query(
    `select 1 from audit_events where actor_user_id = $1 and action = $2 and entity_id = $3 and at > now() - interval '${WINDOW}' limit 1`,
    [actor.userId, action, target.id],
  );
  if ((recent.rowCount ?? 0) > 0) return;
  await appendEvent(tx, {
    action,
    entityType: target.type === 'paper' ? 'wp_item' : target.type,
    entityId: target.id,
    detail: {
      label: target.label,
      ...(target.kind ? { kind: target.kind } : {}),
      ...(target.clientName ? { clientName: target.clientName } : {}),
      ...(target.engagementId ? { engagementId: target.engagementId } : {}),
    },
  });
}
