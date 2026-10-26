import { GRADE, type Actor, type EngagementState, type ItemState, type Role } from './roles';

export type Action =
  | 'engagement.read'
  | 'engagement.transition'
  | 'engagement.assign'
  | 'engagement.assign_eqr'
  | 'engagement.unlock'
  | 'item.edit'
  | 'item.signoff.prepared'
  | 'item.signoff.manager'
  | 'item.signoff.partner'
  | 'item.delete.request'
  | 'item.delete.approve'
  | 'tenant.admin'
  | 'client.manage'
  | 'engagement.create'
  | 'export';

export interface PolicyCtx {
  assigned?: boolean;
  preparerId?: string;
  preparerGrade?: number;
  requesterId?: string;
  requesterGrade?: number;
  engagementPartnerId?: string;
  eqrId?: string;
  itemState?: ItemState;
  engagementState?: EngagementState;
  approver?: { userId: string; role: Role };
}

export type Decision = { allow: boolean; reason?: string };

const allow: Decision = { allow: true };
const deny = (reason: string): Decision => ({ allow: false, reason });

const WORKERS: Role[] = ['staff', 'senior', 'manager', 'partner'];
const gradeOf = (a: Actor) => a.grade ?? GRADE[a.role];

export function can(actor: Actor, action: Action, ctx: PolicyCtx): Decision {
  if (!actor.active) return deny('user is deactivated');

  if (action === 'tenant.admin') {
    return actor.role === 'firm_admin' ? allow : deny('firm admin only');
  }
  if (actor.role === 'firm_admin') return deny('firm admin has no access to engagement content');
  if (action === 'client.manage' || action === 'engagement.create') {
    return actor.role === 'manager' || actor.role === 'partner' ? allow : deny('manager or partner only');
  }
  if (!ctx.assigned) return deny('not assigned to this engagement');

  const locked = ctx.engagementState === 'locked' || ctx.itemState === 'locked';
  const worker = WORKERS.includes(actor.role);

  switch (action) {
    case 'engagement.read':
      return allow;
    case 'export':
      return allow;
    case 'engagement.assign':
    case 'engagement.transition':
      return actor.role === 'manager' || actor.role === 'partner' ? allow : deny('manager or partner only');
    case 'engagement.assign_eqr':
      if (actor.role !== 'partner') return deny('partner only');
      if (ctx.eqrId && ctx.eqrId === ctx.engagementPartnerId) return deny('engagement partner cannot be the EQR');
      return allow;
    case 'engagement.unlock': {
      if (actor.role !== 'partner') return deny('partner only');
      const ap = ctx.approver;
      if (!ap) return deny('second approver required');
      if (ap.userId === actor.userId) return deny('approver must differ from requester');
      if (ap.role !== 'partner' && ap.role !== 'quality_officer') return deny('approver must be partner or quality officer');
      return allow;
    }
    case 'item.edit':
      if (locked) return deny('engagement is locked');
      if (!worker) return deny('role cannot edit');
      if (ctx.itemState === 'partner_approved' && actor.role !== 'partner') return deny('partner-approved items are partner-edit only');
      return allow;
    case 'item.signoff.prepared':
      if (locked) return deny('engagement is locked');
      return worker ? allow : deny('role cannot sign off');
    case 'item.signoff.manager':
    case 'item.signoff.partner': {
      if (locked) return deny('engagement is locked');
      const needed: Role[] = action === 'item.signoff.partner' ? ['partner'] : ['manager', 'partner'];
      if (!needed.includes(actor.role)) return deny(action === 'item.signoff.partner' ? 'partner only' : 'manager or partner only');
      if (ctx.preparerId === actor.userId) return deny('cannot review own work');
      if (action === 'item.signoff.manager' && ctx.preparerGrade !== undefined && gradeOf(actor) <= ctx.preparerGrade) {
        return deny('reviewer grade must exceed preparer grade');
      }
      return allow;
    }
    case 'item.delete.request':
      if (locked) return deny('engagement is locked');
      return worker ? allow : deny('role cannot delete');
    case 'item.delete.approve':
      if (locked) return deny('engagement is locked');
      if (actor.role !== 'manager' && actor.role !== 'partner') return deny('manager or partner only');
      if (ctx.requesterId === actor.userId) return deny('cannot approve own request');
      if (ctx.requesterGrade !== undefined && gradeOf(actor) < ctx.requesterGrade) return deny('approver grade too low');
      return allow;
  }
}
