import { TAXONOMY, type MappedTb } from './mapping';
import type { Money } from './money';

export type FsExceptionCode =
  | 'unbalanced'
  | 'unmapped'
  | 'empty'
  | 'no-comparatives'
  | 'reclassified-balance'
  | 'unusual-balance'
  | 'retained-earnings-rollforward';

export interface FsException {
  code: FsExceptionCode;
  message: string;
  detail?: unknown;
}

export type Figures = Map<string, Money>;

const ASSET_TO_LIABILITY: [string, string][] = [
  ['cash', 'bank_overdraft'],
  ['trade_receivables', 'trade_payables'],
  ['tax_receivable', 'tax_payable'],
];
const LIABILITY_TO_ASSET: [string, string][] = ASSET_TO_LIABILITY.map(([a, l]) => [l, a]);
const RECLASSIFIED = new Set([...ASSET_TO_LIABILITY, ...LIABILITY_TO_ASSET].map(([from]) => from));
const MAY_BE_NEGATIVE = new Set(['retained_earnings', 'other_reserves']);

export function computeFigures(m: MappedTb, exceptions?: FsException[]): Figures {
  const f: Figures = new Map(TAXONOMY.map((l) => [l.id, m.lines.get(l.id) ?? 0n]));
  const g = (id: string) => f.get(id) ?? 0n;

  for (const [from, to] of [...ASSET_TO_LIABILITY, ...LIABILITY_TO_ASSET]) {
    const v = g(from);
    if (v < 0n) {
      f.set(from, 0n);
      f.set(to, g(to) - v);
      exceptions?.push({
        code: 'reclassified-balance',
        message: `${from} has an opposite-sign balance and was presented under ${to}`,
        detail: { from, to, amount: (-v).toString() },
      });
    }
  }
  for (const l of TAXONOMY) {
    if (l.statement !== 'sofp' || RECLASSIFIED.has(l.id) || MAY_BE_NEGATIVE.has(l.id)) continue;
    if (g(l.id) < 0n) {
      exceptions?.push({ code: 'unusual-balance', message: `${l.label} has an unusual (negative) balance`, detail: { id: l.id } });
    }
  }

  const set = (id: string, v: Money) => f.set(id, v);
  set('revenue_total', g('revenue') + g('rental_income'));
  set('gross_profit', g('revenue_total') - g('cost_of_sales'));
  set(
    'profit_before_tax',
    g('gross_profit') + g('other_income') + g('fair_value_gain') - g('selling_expenses') - g('admin_expenses') - g('depreciation') - g('finance_costs'),
  );
  set('operating_profit', g('profit_before_tax') + g('finance_costs'));
  set('profit', g('profit_before_tax') - g('income_tax'));
  set('closing_retained', g('retained_earnings') + g('profit') - g('dividends'));
  set('total_nca', g('ppe') + g('investment_property') + g('intangibles') + g('other_nca'));
  set('total_ca', g('inventories') + g('trade_receivables') + g('tax_receivable') + g('cash'));
  set('total_assets', g('total_nca') + g('total_ca'));
  set('total_equity', g('share_capital') + g('other_reserves') + g('closing_retained'));
  set('total_ncl', g('borrowings_nc') + g('deferred_tax'));
  set('total_cl', g('trade_payables') + g('tax_payable') + g('borrowings_c') + g('bank_overdraft'));
  set('total_equity_liabilities', g('total_equity') + g('total_ncl') + g('total_cl'));
  set('net_cash', g('cash') - g('bank_overdraft'));
  return f;
}
