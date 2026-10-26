import type { FastifyRequest } from 'fastify';
import { can, type Action, type Actor, type PolicyCtx } from '@auditos/authz';

export function httpError(statusCode: number, code: string): Error & { statusCode: number; code: string } {
  return Object.assign(new Error(code), { statusCode, code });
}

export function actorOf(req: FastifyRequest): Actor {
  const a = req.auth;
  if (!a?.tenantId || !a.role) throw httpError(403, 'tenant_required');
  return { userId: a.userId, tenantId: a.tenantId, role: a.role, active: a.membershipActive, ...(a.grade !== null ? { grade: a.grade } : {}) };
}

/** Throws a 403 unless the policy allows the action. Returns the actor for convenience. */
export function assertCan(req: FastifyRequest, action: Action, ctx: PolicyCtx = {}): Actor {
  const actor = actorOf(req);
  const decision = can(actor, action, ctx);
  if (!decision.allow) throw httpError(403, 'forbidden');
  return actor;
}

export const tenantCtx = (req: FastifyRequest) => {
  const a = actorOf(req);
  return { tenantId: a.tenantId, userId: a.userId };
};
