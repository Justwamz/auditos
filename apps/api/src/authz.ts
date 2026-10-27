import type { FastifyRequest } from 'fastify';
import { can, type Action, type Actor, type PolicyCtx } from '@auditos/authz';

export function httpError(statusCode: number, code: string): Error & { statusCode: number; code: string } {
  return Object.assign(new Error(code), { statusCode, code });
}

export function actorOf(req: FastifyRequest): Actor {
  const a = req.auth;
  if (!a?.tenantId || !a.role) throw httpError(403, 'tenant_required');
  return { userId: a.userId, tenantId: a.tenantId, role: a.role, active: a.membershipActive, isAdmin: a.isAdmin, ...(a.grade !== null ? { grade: a.grade } : {}) };
}

/** Throws a 403 unless the policy allows the action. Returns the actor for convenience. */
export function assertCan(req: FastifyRequest, action: Action, ctx: PolicyCtx = {}): Actor {
  const actor = actorOf(req);
  const decision = can(actor, action, ctx);
  if (!decision.allow) throw httpError(403, 'forbidden');
  return actor;
}

/** For checks that only apply to some requests of a route (route-level `stepUp` applies to all of them). */
export function requireFreshStepUp(req: FastifyRequest, maxMinutes = 5): void {
  const age = req.auth?.stepUpAgeSec ?? null;
  if (age === null || age >= maxMinutes * 60) throw httpError(401, 'step_up_required');
}

export const tenantCtx = (req: FastifyRequest) => {
  const a = actorOf(req);
  // Reads may see more than writes can touch (a partner can read every engagement of the firm).
  return { tenantId: a.tenantId, userId: a.userId, readOnly: req.method === 'GET' || req.method === 'HEAD' };
};
