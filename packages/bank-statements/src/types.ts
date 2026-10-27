export type StatementSource = 'pdf' | 'csv' | 'xlsx';

/** One entry on the statement. Money in is positive, money out is negative. */
export interface Txn {
  /** YYYY-MM-DD */
  date: string;
  description: string;
  amountCents: bigint;
  /** Running balance after the entry, when the statement prints one. Overdrawn is negative. */
  balanceCents: bigint | null;
  reference?: string;
}

export interface Issue {
  code: string;
  message: string;
  /** The text of the line concerned, when there is one. */
  line?: string;
}

export interface ParsedStatement {
  source: StatementSource;
  bankName: string | null;
  /** Only the last four characters of the account number are ever kept. */
  accountLast4: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  openingCents: bigint | null;
  closingCents: bigint | null;
  transactions: Txn[];
  /** Which printed heading was taken for each role, so the person can check the reading. */
  columns: Record<string, string>;
  dateOrder: 'dmy' | 'mdy';
  issues: Issue[];
}

export type ReadInput =
  | { kind: 'pdf'; data: Uint8Array; password?: string }
  | { kind: 'csv'; text: string }
  | { kind: 'xlsx'; data: Uint8Array };

export type ErrorCode =
  | 'password_required'
  | 'password_incorrect'
  | 'scanned_pdf'
  | 'not_a_pdf'
  | 'no_table_found'
  | 'too_many_rows'
  | 'unreadable_file';

/** A refusal with a reason the person can act on. */
export class StatementError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StatementError';
  }
}

/** A piece of text on a line with where it sits. For spreadsheets x and right are the column number. */
export interface Cell {
  text: string;
  x: number;
  right: number;
}
export type Line = Cell[];
