import type { PoolClient } from 'pg';
import { z } from 'zod';
import { computeTotals, formatMoney, lineAmount, parseMoney, type TaxLine, type TaxSpec, type Totals } from '@auditos/fs-engine';
import { httpError } from '../authz';

export const uuid = z.string().uuid();

/** Money as the person types it: "1500", "1,500.50" is refused, "1500.50" is fine. Zero or more. */
export const moneyField = (allowZero = false) =>
  z
    .string()
    .trim()
    .max(20)
    .transform((s, ctx) => {
      try {
        const cents = parseMoney(s);
        if (cents < 0n || (!allowZero && cents === 0n)) throw new Error('range');
        return cents;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'enter an amount in KES, for example 1500.00' });
        return z.NEVER;
      }
    });

export const quantityField = z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, 'a quantity such as 1 or 2.5').refine((q) => Number(q) > 0, 'above zero');

export const manualLine = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: quantityField,
  unitPrice: moneyField(true),
});

export const taxMode = z.enum(['exclusive', 'inclusive']);

/** One line of a quote or invoice, with its amount fixed. Time lines carry the entries they bill. */
export interface DraftLine {
  description: string;
  quantity: string;
  unitCents: bigint;
  amountCents: bigint;
  source: 'manual' | 'time' | 'expense' | 'fee';
  sourceIds: string[];
}

export const manualDraftLine = (l: z.infer<typeof manualLine>): DraftLine => ({
  description: l.description, quantity: l.quantity, unitCents: l.unitPrice, amountCents: lineAmount(l.quantity, l.unitPrice), source: 'manual', sourceIds: [],
});

/** The firm's taxes chosen for this document, in the order given. Inactive or unknown taxes are refused: nothing is applied unless chosen. */
export async function loadTaxes(tx: PoolClient, taxIds: string[]): Promise<TaxSpec[]> {
  if (new Set(taxIds).size !== taxIds.length) throw httpError(400, 'invalid_tax');
  const rows = (await tx.query('select id, name, rate_bp, on_previous, active from tax_rates where id = any($1::uuid[])', [taxIds])).rows as {
    id: string; name: string; rate_bp: number; on_previous: boolean; active: boolean;
  }[];
  return taxIds.map((id, i) => {
    const r = rows.find((x) => x.id === id);
    if (!r || !r.active) throw httpError(400, 'invalid_tax');
    // A tax charged on the previous one needs a previous one: as the first, it is charged on the net amount only.
    return { name: r.name, rateBp: r.rate_bp, onPrevious: i === 0 ? false : r.on_previous };
  });
}

/** Totals through the shared engine. Each line is passed as its fixed amount, so time lines are exact to the cent. */
export function totalsOf(lines: DraftLine[], taxes: TaxSpec[], mode: 'exclusive' | 'inclusive'): Totals {
  try {
    return computeTotals(lines.map((l) => ({ quantity: '1', unitCents: l.amountCents })), taxes, mode);
  } catch (e) {
    if (e instanceof RangeError) throw httpError(400, 'invalid_document');
    throw e;
  }
}

export const taxesJson = (t: Totals) =>
  JSON.stringify(t.taxes.map((x) => ({ name: x.name, rateBp: x.rateBp, onPrevious: x.onPrevious, amountCents: x.amountCents.toString() })));

interface StoredTax { name: string; rateBp: number; onPrevious: boolean; amountCents: string }
export const presentTaxes = (stored: unknown) =>
  ((stored as StoredTax[] | null) ?? []).map((t) => ({ name: t.name, rate: (t.rateBp / 100).toFixed(2), onPrevious: t.onPrevious, amount: formatMoney(BigInt(t.amountCents)) }));
export type { TaxLine };

export const money = (cents: string | bigint | number): string => formatMoney(BigInt(cents));
