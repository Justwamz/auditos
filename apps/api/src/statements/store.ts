import { type ParsedStatement } from '@auditos/bank-statements';
import { encrypt } from '../security/crypto';

/** What is kept, encrypted: the entries and what could not be read. The account number is never in it. */
export interface Stored {
  transactions: { date: string; description: string; amountCents: string; balanceCents: string | null; reference?: string }[];
  issues: { code: string; message: string; line?: string }[];
  columns: Record<string, string>;
}

export const pack = (p: ParsedStatement): string =>
  encrypt(JSON.stringify({
    transactions: p.transactions.map((t) => ({ date: t.date, description: t.description, amountCents: t.amountCents.toString(), balanceCents: t.balanceCents === null ? null : t.balanceCents.toString(), ...(t.reference ? { reference: t.reference } : {}) })),
    // The raw line of an unreadable row can carry account details; it is kept short and only inside the encrypted blob.
    issues: p.issues.map((i) => ({ code: i.code, message: i.message, ...(i.line ? { line: i.line.slice(0, 200) } : {}) })),
    columns: p.columns,
  } satisfies Stored));

