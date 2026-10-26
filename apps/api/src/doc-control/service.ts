import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { ItemState, Role } from '@auditos/authz';
import { assertCan, httpError } from '../authz';
import { loadEngagement } from '../engagements/service';

export interface ItemRow {
  id: string;
  engagement_id: string;
  kind: string;
  title: string;
  content: Record<string, unknown>;
  state: ItemState;
  version: number;
  content_hash: string;
  addendum_of: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_reason: string | null;
}

export const ITEM_COLUMNS =
  'id, engagement_id, kind, title, content, state, version, content_hash, addendum_of, created_by, created_at, updated_at, deleted_at, deleted_reason';

/** Visible only to members of the item's engagement (row-level security). `forUpdate` serialises read-modify-write. */
export const loadItem = async (tx: PoolClient, id: string, forUpdate = false): Promise<ItemRow | undefined> =>
  (await tx.query(`select ${ITEM_COLUMNS} from wp_items where id = $1${forUpdate ? ' for update' : ''}`, [id])).rows[0] as ItemRow | undefined;

export const memberGrade = async (tx: PoolClient, userId: string): Promise<{ role: Role; grade: number } | undefined> => {
  const r = (await tx.query('select role, grade from memberships where user_id = $1', [userId])).rows[0];
  return r ? { role: r.role as Role, grade: r.grade as number } : undefined;
};

export const lastEditor = async (tx: PoolClient, item: ItemRow): Promise<{ id: string | null; grade: number }> => {
  const r = (await tx.query('select edited_by from wp_item_versions where item_id = $1 and version = $2', [item.id, item.version])).rows[0];
  const id = (r?.edited_by as string | null) ?? null;
  const m = id ? await memberGrade(tx, id) : undefined;
  return { id, grade: m?.grade ?? 0 };
};

export interface EditPatch {
  title?: string;
  content?: Record<string, unknown>;
  reason?: string;
}

/**
 * The single edit path for working papers: policy check, reason rule, then the update.
 * The database trigger does the versioning and the revoke-on-edit.
 */
export async function editItemTx(
  req: FastifyRequest,
  tx: PoolClient,
  item: ItemRow,
  patch: EditPatch,
): Promise<{ version: number; state: ItemState; contentHash: string }> {
  const eng = await loadEngagement(tx, item.engagement_id);
  if (!eng) throw httpError(404, 'not_found');
  assertCan(req, 'item.edit', { assigned: true, itemState: item.state, engagementState: eng.state });
  if (item.state === 'partner_approved' && !patch.reason) throw httpError(400, 'reason_required');
  await tx.query("select set_config('app.edit_reason', $1, true)", [patch.reason ?? '']);
  const r = await tx.query(
    'update wp_items set title = coalesce($2, title), content = coalesce($3::jsonb, content) where id = $1 returning version, state, content_hash',
    [item.id, patch.title ?? null, patch.content === undefined ? null : JSON.stringify(patch.content)],
  );
  const row = r.rows[0];
  return { version: row.version, state: row.state, contentHash: row.content_hash };
}
