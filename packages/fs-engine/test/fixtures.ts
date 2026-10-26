import { parseMoney } from '../src/money';
import type { Mapping, TbLine } from '../src/mapping';

type Row = [code: string, name: string, side: 'D' | 'C', amount: string, lineId: string];

export interface Fixture {
  tb: TbLine[];
  mapping: Mapping;
  expectedProfit: bigint;
  expectedAssets: bigint;
}

function build(rows: Row[], expectedProfit: string, expectedAssets: string): Fixture {
  const mapping: Mapping = {};
  const tb = rows.map(([code, name, side, amount, lineId]) => {
    mapping[code] = lineId;
    const v = parseMoney(amount);
    return { code, name, debit: side === 'D' ? v : 0n, credit: side === 'C' ? v : 0n };
  });
  return { tb, mapping, expectedProfit: parseMoney(expectedProfit), expectedAssets: parseMoney(expectedAssets) };
}

export const trading = build(
  [
    ['1000', 'Cash at bank', 'D', '150000.00', 'cash'],
    ['1100', 'Trade debtors', 'D', '200000.00', 'trade_receivables'],
    ['1200', 'Stock', 'D', '300000.00', 'inventories'],
    ['1500', 'Motor vehicles', 'D', '500000.00', 'ppe'],
    ['2000', 'Trade creditors', 'C', '180000.00', 'trade_payables'],
    ['2100', 'Bank loan', 'C', '250000.00', 'borrowings_nc'],
    ['2200', 'Tax payable', 'C', '40000.00', 'tax_payable'],
    ['3000', 'Share capital', 'C', '100000.00', 'share_capital'],
    ['3100', 'Retained earnings', 'C', '450000.00', 'retained_earnings'],
    ['4000', 'Sales', 'C', '2000000.00', 'revenue'],
    ['5000', 'Purchases', 'D', '1400000.00', 'cost_of_sales'],
    ['6000', 'Salaries', 'D', '300000.00', 'admin_expenses'],
    ['6100', 'Depreciation', 'D', '100000.00', 'depreciation'],
    ['6200', 'Interest paid', 'D', '30000.00', 'finance_costs'],
    ['6300', 'Income tax', 'D', '40000.00', 'income_tax'],
  ],
  '130000.00',
  '1150000.00',
);

export const consultancy = build(
  [
    ['1000', 'Cash', 'D', '400000.00', 'cash'],
    ['1100', 'Fees receivable', 'D', '250000.00', 'trade_receivables'],
    ['1500', 'Computers', 'D', '120000.00', 'ppe'],
    ['2000', 'Creditors', 'C', '90000.00', 'trade_payables'],
    ['2200', 'Tax payable', 'C', '60000.00', 'tax_payable'],
    ['3000', 'Share capital', 'C', '50000.00', 'share_capital'],
    ['3100', 'Retained earnings', 'C', '70000.00', 'retained_earnings'],
    ['4000', 'Professional fees', 'C', '1700000.00', 'revenue'],
    ['6000', 'Salaries', 'D', '900000.00', 'admin_expenses'],
    ['6050', 'Office rent', 'D', '200000.00', 'admin_expenses'],
    ['6100', 'Depreciation', 'D', '40000.00', 'depreciation'],
    ['6300', 'Income tax', 'D', '60000.00', 'income_tax'],
  ],
  '500000.00',
  '770000.00',
);

export const rental = build(
  [
    ['1000', 'Cash', 'D', '300000.00', 'cash'],
    ['1100', 'Rent receivable', 'D', '50000.00', 'trade_receivables'],
    ['1600', 'Investment property', 'D', '5000000.00', 'investment_property'],
    ['2000', 'Tenant deposits', 'C', '150000.00', 'trade_payables'],
    ['2100', 'Mortgage', 'C', '2000000.00', 'borrowings_nc'],
    ['3000', 'Share capital', 'C', '500000.00', 'share_capital'],
    ['3100', 'Retained earnings', 'C', '1950000.00', 'retained_earnings'],
    ['4000', 'Rental income', 'C', '900000.00', 'rental_income'],
    ['4100', 'Fair value gain', 'C', '300000.00', 'fair_value_gain'],
    ['6000', 'Repairs', 'D', '80000.00', 'admin_expenses'],
    ['6010', 'Rates and insurance', 'D', '70000.00', 'admin_expenses'],
    ['6200', 'Mortgage interest', 'D', '200000.00', 'finance_costs'],
    ['6300', 'Income tax', 'D', '100000.00', 'income_tax'],
  ],
  '750000.00',
  '5350000.00',
);
