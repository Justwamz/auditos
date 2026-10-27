'use client';
import { useApi } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/text';

interface Me { fullName: string | null; email: string; role: string; isAdmin: boolean }
interface ClientRow { name: string; relationship: 'account_manager' | 'team' | 'oversight' }
interface EngagementRow { member: boolean }

/** A plain statement of what this person can see and why, so each profile in the demo is easy to tell apart. */
export function WhatYouSee() {
  const me = useApi<Me>('/me');
  const clients = useApi<{ clients: ClientRow[] }>('/clients');
  const engagements = useApi<{ engagements: EngagementRow[] }>('/engagements');
  if (!me.data || !clients.data) return null;

  const role = me.data.role;
  const list = clients.data.clients;
  const managed = list.filter((c) => c.relationship === 'account_manager');
  const team = list.filter((c) => c.relationship === 'team');
  const oversight = list.filter((c) => c.relationship === 'oversight');
  const viewOnly = engagements.data?.engagements.filter((e) => !e.member).length ?? 0;
  const names = (rows: ClientRow[]) => rows.map((c) => c.name).join(', ');

  const rule =
    role === 'partner'
      ? 'As a partner you can see every client and read every engagement of the firm. You can change only the engagements you are on the team of.'
      : role === 'firm_admin'
        ? 'As the firm administrator you can see the client list and manage people and access. You cannot open engagement files.'
        : role === 'manager'
          ? 'As a manager you see the clients you manage, and the clients whose engagement teams you are on. Nothing else.'
          : 'You see only the clients whose engagement teams you are on. Nothing else.';

  return (
    <section className="sheet stack" aria-label="What you can see">
      <h2>What you can see</h2>
      <p>
        <strong>{me.data.fullName ?? me.data.email}</strong>, {ROLE_LABELS[role] ?? role}
        {me.data.isAdmin && role !== 'firm_admin' ? ', with the administrator permission' : ''}. {rule}
      </p>
      <ul className="item-list">
        <li><strong>Clients you manage ({managed.length}).</strong> {managed.length > 0 ? names(managed) : 'None.'}</li>
        <li><strong>Clients you see through an engagement team ({team.length}).</strong> {team.length > 0 ? names(team) : 'None.'}</li>
        {(role === 'partner' || role === 'firm_admin' || me.data.isAdmin) && (
          <li><strong>Other clients you see because of your role ({oversight.length}).</strong> {oversight.length > 0 ? names(oversight) : 'None.'}</li>
        )}
        {role === 'partner' && <li><strong>Engagements open to you for viewing only ({viewOnly}).</strong> You can read them but not change them.</li>}
      </ul>
      {list.length === 0 && <p className="notice warn">You are not on any engagement team yet, so you see no clients. Ask a manager to add you.</p>}
    </section>
  );
}
