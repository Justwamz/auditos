import type { Statements, TbLine } from '@auditos/fs-engine';

export interface ExportMeta {
  entityName: string;
  periodEnd: string;
  draft: boolean;
  exportedBy: string;
  exportedAt: string;
  trialBalance?: TbLine[];
}

export interface Block {
  title: string;
  head: string[];
  rows: { cells: string[]; bold?: boolean }[];
}

/** 1,234.50 and (5.00) for negatives. */
export function fmt(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = `${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
  return neg ? `(${s})` : s;
}

/** Cells that start with a formula trigger are prefixed so spreadsheet software shows them as text. */
export function escapeCell(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const priorYearLabel = (periodEnd: string): string => `${Number(periodEnd.slice(0, 4)) - 1}${periodEnd.slice(4)}`;

export function blocks(s: Statements): Block[] {
  const cur = s.periodEnd;
  const head = s.hasComparatives ? ['', cur, priorYearLabel(cur)] : ['', cur];
  const cells = (label: string, c: bigint, p?: bigint): string[] =>
    s.hasComparatives ? [label, fmt(c), fmt(p ?? 0n)] : [label, fmt(c)];

  const sofp: Block = { title: 'Statement of financial position', head, rows: [] };
  for (const sec of s.sofp.sections) {
    if (sec.rows.length === 0) continue;
    sofp.rows.push({ cells: s.hasComparatives ? [sec.label, '', ''] : [sec.label, ''], bold: true });
    for (const r of sec.rows) sofp.rows.push({ cells: cells(r.label, r.current, r.prior) });
    sofp.rows.push({ cells: cells(`Total ${sec.label.toLowerCase()}`, sec.total, sec.priorTotal), bold: true });
    if (sec.id === 'current_assets') sofp.rows.push({ cells: cells('Total assets', s.sofp.totalAssets, s.sofp.priorTotalAssets), bold: true });
  }
  sofp.rows.push({ cells: cells('Total equity and liabilities', s.sofp.totalEquityAndLiabilities, s.sofp.priorTotalEquityAndLiabilities), bold: true });

  const pl: Block = {
    title: 'Statement of profit or loss',
    head,
    rows: s.pl.rows.map((r) => ({ cells: cells(r.label, r.current, r.prior), bold: r.subtotal === true })),
  };

  const eqHead = ['', 'Share capital', 'Other reserves', 'Retained earnings', 'Total'];
  const equity: Block = {
    title: 'Statement of changes in equity',
    head: eqHead,
    rows: s.equity.rows.map((r) => ({
      cells: [r.label, ...(['share_capital', 'other_reserves', 'retained_earnings', 'total'] as const).map((k) => fmt(r.values[k]))],
      bold: r.id === 'closing',
    })),
  };

  const out: Block[] = [sofp, pl, equity];
  if (s.cashflow) {
    out.push({
      title: 'Statement of cash flows',
      head: ['', cur],
      rows: [
        ...s.cashflow.rows.map((r) => ({ cells: [r.label, fmt(r.current)], bold: r.subtotal === true })),
        { cells: ['Net movement in cash and cash equivalents', fmt(s.cashflow.netMovement)], bold: true },
        { cells: ['Cash and cash equivalents at start of period', fmt(s.cashflow.openingCash)] },
        { cells: ['Cash and cash equivalents at end of period', fmt(s.cashflow.closingCash)], bold: true },
      ],
    });
  }
  for (const n of s.notes) {
    out.push({ title: `Note: ${n.title}`, head, rows: n.rows.map((r) => ({ cells: cells(r.label, r.current, r.prior) })) });
  }
  return out;
}

export const footerText = (m: ExportMeta): string => `Exported by ${m.exportedBy} on ${m.exportedAt}`;
export const titleText = (m: ExportMeta): string => `${m.entityName}: financial statements for the year ended ${m.periodEnd}`;
