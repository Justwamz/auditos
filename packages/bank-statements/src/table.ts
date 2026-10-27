import { findHeader, roleOf, type Column, type Role } from './header';
import { StatementError, type Cell, type Issue, type Line, type ParsedStatement, type StatementSource, type Txn } from './types';
import { parseAmount, parseDate } from './values';

const MONEY_ROLES: Role[] = ['debit', 'credit', 'amount', 'balance'];
const BANKS: [RegExp, string][] = [
  [/equity/i, 'Equity'], [/\bkcb\b/i, 'KCB'], [/co-?operative/i, 'Co-operative Bank'], [/ncba/i, 'NCBA'], [/absa/i, 'Absa'],
  [/stanbic/i, 'Stanbic'], [/standard chartered/i, 'Standard Chartered'], [/i ?& ?m bank/i, 'I&M'], [/\bdtb\b|diamond trust/i, 'DTB'],
  [/family bank/i, 'Family Bank'], [/m-?pesa|safaricom/i, 'M-Pesa'], [/national bank/i, 'National Bank'],
];
const OPENING = /(?:balance\s+(?:brought\s+forward|b\/?f|b\/d)|brought\s+forward|opening\s+balance|balance\s+at\s+start|previous\s+balance)/i;
const CLOSING = /(?:balance\s+(?:carried\s+forward|c\/?f|c\/d)|carried\s+forward|closing\s+balance|balance\s+at\s+end)/i;
const FOOTER = /^(?:page\s+\d|statement\s+(?:generated|printed)|printed\s+on|end\s+of\s+statement|this\s+is\s+a\s+computer|continued|\*+)/i;

const centre = (c: { x: number; right: number }) => (c.x + c.right) / 2;
const distance = (cell: Cell, col: Column) => Math.min(Math.abs(cell.x - col.x), Math.abs(cell.right - col.right), Math.abs(centre(cell) - centre(col)));

/** The column a cell belongs under. Money goes to the nearest money column, dates to the date column, other text to the nearest text column. */
function columnFor(cell: Cell, columns: Column[]): Column | null {
  const numeric = parseAmount(cell.text) !== null;
  const pool = numeric ? columns.filter((c) => MONEY_ROLES.includes(c.role)) : columns.filter((c) => !MONEY_ROLES.includes(c.role) || parseAmount(cell.text) !== null);
  const candidates = pool.length > 0 ? pool : columns;
  let best: Column | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(cell, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function detectOrder(texts: string[]): 'dmy' | 'mdy' {
  const numeric = texts.filter((t) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(t.trim()));
  if (numeric.length === 0) return 'dmy';
  const dmy = numeric.every((t) => parseDate(t, 'dmy') !== null);
  if (dmy) return 'dmy';
  return numeric.every((t) => parseDate(t, 'mdy') !== null) ? 'mdy' : 'dmy';
}

function describeMeta(pre: Line[]): { bankName: string | null; accountLast4: string | null; periodFrom: string | null; periodTo: string | null } {
  const text = pre.map((l) => l.map((c) => c.text).join(' ')).join('\n');
  const bankName = BANKS.find(([re]) => re.test(text))?.[1] ?? null;
  const acct = /account\s*(?:no\.?|number|#)\s*[:\-]?\s*([\dxX*][\dxX*\- ]{5,})/i.exec(text);
  const digits = acct ? acct[1]!.replace(/[^0-9xX*]/g, '') : '';
  const period = /(\d{1,2}[ /.-][A-Za-z0-9]{1,9}[ /.-]\d{2,4})\s*(?:to|-|–)\s*(\d{1,2}[ /.-][A-Za-z0-9]{1,9}[ /.-]\d{2,4})/i.exec(text);
  return {
    bankName,
    accountLast4: digits.length >= 4 ? digits.slice(-4) : null,
    periodFrom: period ? parseDate(period[1]!) : null,
    periodTo: period ? parseDate(period[2]!) : null,
  };
}

interface Draft {
  date: string;
  description: string;
  amount: bigint | null;
  side: 'out' | 'in' | null;
  balance: bigint | null;
  reference: string;
  line: string;
}

/**
 * Turns the lines of a statement (from a PDF, CSV or workbook) into entries. The heading row says what each column is;
 * what cannot be read is reported as an issue rather than dropped or guessed.
 */
export function parseTable(lines: Line[], source: StatementSource): ParsedStatement {
  const header = findHeader(lines);
  if (!header) throw new StatementError('no_table_found', 'No statement table was found. The file needs a heading row with a date column and money columns such as Debit, Credit or Balance.');
  const { columns } = header;
  const issues: Issue[] = [];
  const meta = describeMeta(lines.slice(0, header.index));
  const body = lines.slice(header.index + 1);
  const headerRoles = new Set(columns.map((c) => c.role));
  const dateCol = columns.find((c) => c.role === 'date')!;

  const dateTexts: string[] = [];
  for (const line of body) for (const cell of line) if (columnFor(cell, columns)?.role === 'date') dateTexts.push(cell.text);
  const order = detectOrder(dateTexts);

  const drafts: Draft[] = [];
  let opening: bigint | null = null;
  let closing: bigint | null = null;

  for (const line of body) {
    const by = new Map<Role, string[]>();
    for (const cell of line) {
      const col = columnFor(cell, columns);
      if (!col || col.role === 'ignore') continue;
      by.set(col.role, [...(by.get(col.role) ?? []), cell.text.trim()]);
    }
    const lineText = line.map((c) => c.text).join(' ').trim();
    if (lineText === '') continue;
    const roles = new Set(line.map((c) => roleOf(c.text)).filter(Boolean));
    if (roles.size >= 2 && [...roles].every((r) => headerRoles.has(r!))) continue; // heading repeated on a later page

    const text = (r: Role) => (by.get(r) ?? []).join(' ').trim();
    const description = [text('description'), text('reference') && !roles.size ? '' : ''].join('').trim() || text('description');
    const balanceAmount = parseAmount(text('balance'));
    const balance = balanceAmount ? (balanceAmount.side === 'dr' ? -balanceAmount.cents : balanceAmount.side === 'cr' ? balanceAmount.cents : balanceAmount.cents) : null;
    const lone = [text('amount'), text('debit'), text('credit')].map((t) => parseAmount(t)).find((a) => a !== null) ?? null;

    if (OPENING.test(lineText) || CLOSING.test(lineText)) {
      const value = balance ?? lone?.cents ?? null;
      if (value !== null) {
        if (OPENING.test(lineText)) opening = value;
        else closing = value;
      }
      continue;
    }

    const dateText = text('date') || (dateCol ? '' : '');
    const date = dateText ? parseDate(dateText, order) : null;
    const dr = parseAmount(text('debit'));
    const cr = parseAmount(text('credit'));
    const am = parseAmount(text('amount'));
    const hasMoney = dr !== null || cr !== null || am !== null;

    if (date) {
      let amount: bigint | null = null;
      let side: Draft['side'] = null;
      if (dr && cr) {
        amount = cr.cents - dr.cents;
        side = amount < 0n ? 'out' : 'in';
        issues.push({ code: 'both_columns', message: 'A row has both a debit and a credit; the difference was used.', line: lineText });
      } else if (dr) {
        amount = -(dr.cents < 0n ? -dr.cents : dr.cents);
        side = 'out';
      } else if (cr) {
        amount = cr.cents < 0n ? -cr.cents : cr.cents;
        amount = amount < 0n ? -amount : amount;
        side = 'in';
      } else if (am) {
        if (am.side === 'dr') amount = -(am.cents < 0n ? -am.cents : am.cents);
        else if (am.side === 'cr') amount = am.cents < 0n ? -am.cents : am.cents;
        else if (am.cents < 0n) amount = am.cents;
        else amount = am.cents; // direction decided below from the running balance
        side = am.side === 'dr' || am.cents < 0n ? 'out' : am.side === 'cr' ? 'in' : null;
      }
      if (amount === null) {
        issues.push({ code: 'unreadable_row', message: 'A row has a date but no amount that could be read.', line: lineText });
        continue;
      }
      drafts.push({ date, description: description, amount, side, balance, reference: text('reference'), line: lineText });
      continue;
    }

    if (hasMoney && (dateText !== '' || description !== '' || balance !== null)) {
      issues.push({ code: 'unreadable_row', message: 'A row with an amount has no readable date, so it was not counted.', line: lineText });
      continue;
    }
    if (description !== '' && !hasMoney && balance === null && !FOOTER.test(description)) {
      const last = drafts.at(-1);
      if (last) last.description = `${last.description} ${description}`.trim();
    }
  }

  // Direction of unsigned single-column amounts comes from how the running balance moved.
  let previous: bigint | null = opening;
  for (const d of drafts) {
    if (d.side === null && d.amount !== null) {
      const abs = d.amount < 0n ? -d.amount : d.amount;
      if (d.balance !== null && previous !== null && d.balance - previous === abs) d.amount = abs;
      else if (d.balance !== null && previous !== null && d.balance - previous === -abs) d.amount = -abs;
      else issues.push({ code: 'direction_unknown', message: 'Money in and money out could not be told apart for a row; check the statement.', line: d.line });
    }
    if (d.balance !== null) previous = d.balance;
  }

  const transactions: Txn[] = drafts.map((d) => ({ date: d.date, description: d.description, amountCents: d.amount ?? 0n, balanceCents: d.balance, ...(d.reference ? { reference: d.reference } : {}) }));
  if (transactions.length === 0) throw new StatementError('no_table_found', 'The statement table was found but no dated entries could be read from it.');
  if (transactions.length > 20_000) throw new StatementError('too_many_rows', 'This statement has more than 20,000 entries. Split it by month and upload the parts.');

  // Some banks print newest first: put the entries in date order, keeping the original order within a day.
  if (transactions.length > 1 && transactions[0]!.date > transactions.at(-1)!.date) {
    transactions.reverse();
    issues.push({ code: 'reversed_order', message: 'The statement was printed newest first; entries were put in date order.' });
  }

  const first = transactions[0]!;
  const last = transactions.at(-1)!;
  if (opening === null && first.balanceCents !== null) opening = first.balanceCents - first.amountCents;
  if (closing === null && last.balanceCents !== null) closing = last.balanceCents;

  const dates = transactions.map((t) => t.date).sort();
  return {
    source,
    bankName: meta.bankName,
    accountLast4: meta.accountLast4,
    periodFrom: meta.periodFrom ?? dates[0]!,
    periodTo: meta.periodTo ?? dates.at(-1)!,
    openingCents: opening,
    closingCents: closing,
    transactions,
    columns: Object.fromEntries(columns.filter((c) => c.role !== 'ignore').map((c) => [c.role, c.heading])),
    dateOrder: order,
    issues,
  };
}
