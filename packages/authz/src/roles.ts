export type Role = 'firm_admin' | 'partner' | 'manager' | 'senior' | 'staff' | 'quality_officer' | 'eqr';

export const GRADE: Record<Role, number> = {
  firm_admin: 0,
  staff: 1,
  senior: 2,
  manager: 3,
  quality_officer: 3,
  partner: 4,
  eqr: 4,
};

export type ItemState = 'draft' | 'prepared' | 'manager_reviewed' | 'partner_approved' | 'locked';
export type EngagementState =
  | 'onboarding' | 'planning' | 'fieldwork' | 'completion'
  | 'review' | 'partner_approved' | 'report_issued' | 'locked';

export interface Actor {
  userId: string;
  tenantId: string;
  role: Role;
  active: boolean;
  grade?: number;
  /** Holds the admin permission (users, access and the audit trail), whatever their role. */
  isAdmin?: boolean;
}
