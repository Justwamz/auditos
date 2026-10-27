import { computeFigures, type FsException } from './figures';
import type { MappedTb } from './mapping';
import type { Money } from './money';

export interface CashFlowRow {
  id: string;
  label: string;
  current: Money;
  subtotal?: boolean;
}
export interface CashFlow {
  rows: CashFlowRow[];
  netMovement: Money;
  openingCash: Money;
  closingCash: Money;
}

export function buildCashFlowIndirect(
  current: MappedTb,
  prior: MappedTb | undefined,
): { statement?: CashFlow; exceptions: FsException[] } {
  if (!prior) {
    return {
      exceptions: [{ code: 'no-comparatives', message: 'Cash flow statement needs the prior-year trial balance' }],
    };
  }
  const exceptions: FsException[] = [];
  const c = computeFigures(current);
  const p = computeFigures(prior);
  const cur = (id: string) => c.get(id) ?? 0n;
  const d = (id: string) => cur(id) - (p.get(id) ?? 0n);

  const rollforwardDiff = cur('retained_earnings') - (p.get('closing_retained') ?? 0n);
  if (rollforwardDiff !== 0n) {
    exceptions.push({
      code: 'retained-earnings-rollforward',
      message: 'Opening retained earnings differ from the prior-year closing balance',
      detail: { difference: rollforwardDiff.toString() },
    });
  }

  const wc = -d('inventories') - d('trade_receivables') + d('trade_payables');
  const generated = cur('profit_before_tax') + cur('depreciation') - cur('fair_value_gain') + wc;
  const taxPaid = -cur('income_tax') + d('tax_payable') - d('tax_receivable') + d('deferred_tax');
  const cfo = generated + taxPaid;
  const capex = -(d('ppe') + d('intangibles') + d('other_nca') + cur('depreciation'));
  const ipPurchases = -(d('investment_property') - cur('fair_value_gain'));
  const cfi = capex + ipPurchases;
  const equityIssued = d('share_capital') + d('other_reserves');
  const borrowings = d('borrowings_nc') + d('borrowings_c');
  const dividendsPaid = -cur('dividends');
  const cff = equityIssued + borrowings + dividendsPaid;
  const net = cfo + cfi + cff;

  const rows: CashFlowRow[] = [
    { id: 'pbt', label: 'Profit before tax', current: cur('profit_before_tax') },
    { id: 'depreciation', label: 'Depreciation and amortisation', current: cur('depreciation') },
    { id: 'fair_value_gain', label: 'Fair value gain on investment property', current: -cur('fair_value_gain') },
    { id: 'inventories', label: '(Increase)/decrease in inventories', current: -d('inventories') },
    { id: 'receivables', label: '(Increase)/decrease in receivables', current: -d('trade_receivables') },
    { id: 'payables', label: 'Increase/(decrease) in payables', current: d('trade_payables') },
    { id: 'cash_generated', label: 'Cash generated from operations', current: generated, subtotal: true },
    { id: 'tax_paid', label: 'Tax paid', current: taxPaid },
    { id: 'cfo', label: 'Net cash from operating activities', current: cfo, subtotal: true },
    { id: 'capex', label: 'Purchase of property, plant, equipment and intangibles', current: capex },
    { id: 'ip_purchases', label: 'Purchase of investment property', current: ipPurchases },
    { id: 'cfi', label: 'Net cash used in investing activities', current: cfi, subtotal: true },
    { id: 'equity_issued', label: 'Proceeds from share capital and reserves', current: equityIssued },
    { id: 'borrowings', label: 'Net movement in borrowings', current: borrowings },
    { id: 'dividends', label: 'Dividends paid', current: dividendsPaid },
    { id: 'cff', label: 'Net cash from financing activities', current: cff, subtotal: true },
  ];

  const openingCash = p.get('net_cash') ?? 0n;
  const closingCash = cur('net_cash');
  const gap = closingCash - openingCash - net;
  if (gap !== 0n) {
    rows.push({ id: 'unreconciled', label: 'Unreconciled difference (investigate before issue)', current: gap });
    exceptions.push({
      code: 'cashflow-unreconciled',
      message: 'The cash flow statement does not explain the whole movement in cash; the difference is shown on its own line',
      detail: { difference: gap.toString() },
    });
  }

  return { statement: { rows, netMovement: net + gap, openingCash, closingCash }, exceptions };
}
