import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import {
  buildStatements, disclosureChecklist, formatMoney, mapTrialBalance, parseMoney, resolveFramework,
  type BuildResult, type FrameworkVersion, type Framework, type Mapping, type TbLine,
} from '@auditos/fs-engine';
import { editItemTx, ITEM_COLUMNS, type ItemRow } from '../doc-control/service';
import type { EngagementRow } from '../engagements/service';

export interface TbLineText {
  code: string;
  name: string;
  debit: string;
  credit: string;
}
export interface AdjustmentLine {
  code: string;
  debit: string;
  credit: string;
}
export type AdjustmentStatus = 'proposed' | 'agreed' | 'unadjusted';
export interface AdjustmentEntry {
  id: string;
  description: string;
  status: AdjustmentStatus;
  lines: AdjustmentLine[];
  createdBy: string;
  createdAt: string;
}

export const SINGLETON_KINDS = ['trial_balance', 'trial_balance_prior', 'fs_mapping', 'adjustments'] as const;
export type SingletonKind = (typeof SINGLETON_KINDS)[number];

export interface Financials {
  tb?: ItemRow;
  prior?: ItemRow;
  mapping?: ItemRow;
  adjustments?: ItemRow;
  notes: ItemRow[];
}

export async function loadFinancials(tx: PoolClient, engagementId: string): Promise<Financials> {
  const rows = (
    await tx.query(
      `select ${ITEM_COLUMNS} from wp_items where engagement_id = $1 and deleted_at is null
         and kind in ('trial_balance','trial_balance_prior','fs_mapping','adjustments','fs_note') order by created_at`,
      [engagementId],
    )
  ).rows as ItemRow[];
  const by = (k: string) => rows.find((r) => r.kind === k);
  return { tb: by('trial_balance'), prior: by('trial_balance_prior'), mapping: by('fs_mapping'), adjustments: by('adjustments'), notes: rows.filter((r) => r.kind === 'fs_note') };
}

export const toTbLines = (lines: TbLineText[]): TbLine[] =>
  lines.map((l) => ({ code: l.code, name: l.name, debit: parseMoney(l.debit), credit: parseMoney(l.credit) }));

export const fromTbLines = (lines: TbLine[]): TbLineText[] =>
  lines.map((l) => ({ code: l.code, name: l.name, debit: formatMoney(l.debit), credit: formatMoney(l.credit) }));

/** Posts agreed entries to the trial balance. Proposed and unadjusted entries are not posted. */
export function applyAdjustments(lines: TbLine[], entries: AdjustmentEntry[]): TbLine[] {
  const out = lines.map((l) => ({ ...l }));
  for (const e of entries.filter((x) => x.status === 'agreed')) {
    for (const al of e.lines) {
      const target = out.find((l) => l.code === al.code);
      if (!target) continue;
      target.debit += parseMoney(al.debit);
      target.credit += parseMoney(al.credit);
    }
  }
  return out;
}

export function unadjustedTotal(entries: AdjustmentEntry[]): string {
  let total = 0n;
  for (const e of entries.filter((x) => x.status === 'unadjusted')) for (const l of e.lines) total += parseMoney(l.debit);
  return formatMoney(total);
}

export const tbOf = (item?: ItemRow): TbLineText[] => ((item?.content.lines as TbLineText[] | undefined) ?? []);
export const mappingOf = (item?: ItemRow): Mapping => ((item?.content.mapping as Mapping | undefined) ?? {});
export const entriesOf = (item?: ItemRow): AdjustmentEntry[] => ((item?.content.entries as AdjustmentEntry[] | undefined) ?? []);

export interface Computed {
  frameworkVersion: FrameworkVersion;
  result: BuildResult;
  disclosures?: ReturnType<typeof disclosureChecklist>;
  unadjustedTotal: string;
}

/** Throws UnsupportedFrameworkError for full IFRS clients. */
export function computeStatements(eng: EngagementRow, f: Financials): Computed {
  const framework = eng.framework as Framework;
  const frameworkVersion = resolveFramework(framework, eng.period_start);
  const mapping = mappingOf(f.mapping);
  const entries = entriesOf(f.adjustments);
  const current = mapTrialBalance(applyAdjustments(toTbLines(tbOf(f.tb)), entries), mapping);

  let prior;
  if (f.prior) {
    prior = mapTrialBalance(toTbLines(tbOf(f.prior)), mapping);
    if (prior.unmapped.length > 0 || !prior.balanced) {
      return {
        frameworkVersion,
        unadjustedTotal: unadjustedTotal(entries),
        result: {
          ok: false,
          blockers: [{
            code: prior.unmapped.length > 0 ? 'unmapped' : 'unbalanced',
            message: 'The prior-year trial balance is not fully mapped and balanced',
            detail: { priorYear: true },
          }],
        },
      };
    }
  }

  const result = buildStatements(current, { periodStart: eng.period_start, periodEnd: eng.period_end, framework, ...(prior ? { prior } : {}) });
  if (!result.ok) return { frameworkVersion, result, unadjustedTotal: unadjustedTotal(entries) };

  for (const n of f.notes) {
    const noteId = n.content.noteId as string | undefined;
    if (noteId && !result.statements.notes.some((x) => x.id === noteId)) {
      result.statements.notes.push({ id: noteId, title: n.title, rows: [] });
    }
  }
  return {
    frameworkVersion,
    result,
    disclosures: disclosureChecklist(frameworkVersion, result.statements),
    unadjustedTotal: unadjustedTotal(entries),
  };
}

/** Creates the single paper of this kind or edits the existing one (a new version, with review revoked). */
export async function upsertSingleton(
  req: FastifyRequest,
  tx: PoolClient,
  ctx: { tenantId: string; userId: string },
  engagementId: string,
  kind: SingletonKind,
  title: string,
  content: Record<string, unknown>,
  existing: ItemRow | undefined,
): Promise<{ version: number; id: string }> {
  if (existing) {
    const r = await editItemTx(req, tx, existing, { content, reason: 'Updated in the financial statements module' });
    return { version: r.version, id: existing.id };
  }
  const r = await tx.query(
    'insert into wp_items (tenant_id, engagement_id, kind, title, content, created_by) values ($1, $2, $3, $4, $5, $6) returning id, version',
    [ctx.tenantId, engagementId, kind, title, JSON.stringify(content), ctx.userId],
  );
  return { version: r.rows[0].version as number, id: r.rows[0].id as string };
}

export const bigintJson = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
