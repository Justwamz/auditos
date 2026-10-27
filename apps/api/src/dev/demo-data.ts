import type { Pool, PoolClient } from 'pg';

const SYNTHETIC_CLIENT = 'Mwangaza Traders Ltd';

type Row = [code: string, name: string, side: 'D' | 'C', amount: string, line: string];

// Synthetic figures. FY2025 closes with retained earnings of 450,000.00, which is the FY2026 opening balance.
const TB_2026: Row[] = [
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
];
const TB_2025: Row[] = [
  ['1000', 'Cash at bank', 'D', '145000.00', 'cash'],
  ['1100', 'Trade debtors', 'D', '180000.00', 'trade_receivables'],
  ['1200', 'Stock', 'D', '250000.00', 'inventories'],
  ['1500', 'Motor vehicles', 'D', '450000.00', 'ppe'],
  ['2000', 'Trade creditors', 'C', '160000.00', 'trade_payables'],
  ['2100', 'Bank loan', 'C', '280000.00', 'borrowings_nc'],
  ['2200', 'Tax payable', 'C', '35000.00', 'tax_payable'],
  ['3000', 'Share capital', 'C', '100000.00', 'share_capital'],
  ['3100', 'Retained earnings', 'C', '340000.00', 'retained_earnings'],
  ['4000', 'Sales', 'C', '1800000.00', 'revenue'],
  ['5000', 'Purchases', 'D', '1250000.00', 'cost_of_sales'],
  ['6000', 'Salaries', 'D', '280000.00', 'admin_expenses'],
  ['6100', 'Depreciation', 'D', '90000.00', 'depreciation'],
  ['6200', 'Interest paid', 'D', '35000.00', 'finance_costs'],
  ['6300', 'Income tax', 'D', '35000.00', 'income_tax'],
];

const asContent = (rows: Row[]) => ({
  lines: rows.map(([code, name, side, amount]) => ({ code, name, debit: side === 'D' ? amount : '0.00', credit: side === 'C' ? amount : '0.00' })),
  source: 'import',
});
const asMapping = (rows: Row[]) => ({ mapping: Object.fromEntries(rows.map(([code, , , , line]) => [code, line])) });

async function as(c: PoolClient, tenantId: string, userId: string): Promise<void> {
  await c.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [tenantId, userId]);
}

/** Idempotent. Synthetic only. Needs the seeded Kangethe & Associates users. */
export async function seedDemoData(owner: Pool, firmName = 'Kangethe & Associates', slug = 'firm-a'): Promise<boolean> {
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    const tenantId = (await c.query('select id from tenants where name = $1', [firmName])).rows[0]?.id as string | undefined;
    if (!tenantId) throw new Error('Seed the demo firm first');
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const user = async (role: string): Promise<string> =>
      (await c.query('select id from users where lower(email) = $1', [`${role.replace('_', '-')}@${slug}.example.test`])).rows[0].id as string;
    const ids: string[] = [];
    for (const role of ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr']) ids.push(await user(role));
    const [partner, manager, senior, staff, qo, eqr] = ids;

    await as(c, tenantId, manager!);
    if ((await c.query('select 1 from clients where name = $1', [SYNTHETIC_CLIENT])).rowCount) {
      await c.query('ROLLBACK');
      return false;
    }

    for (const id of [partner!, manager!, senior!, staff!, qo!, eqr!]) {
      await as(c, tenantId, id);
      await c.query("insert into independence_declarations (tenant_id, user_id, statement) values ($1, $2, 'Synthetic demo declaration: no relationships that impair independence.')", [tenantId, id]);
    }

    await as(c, tenantId, manager!);
    const clientId = (
      await c.query(
        "insert into clients (tenant_id, name, sector, legal_form, framework, year_end_month, created_by) values ($1, $2, 'trading', 'Limited company', 'IFRS_SME', 12, $3) returning id",
        [tenantId, SYNTHETIC_CLIENT, manager],
      )
    ).rows[0].id as string;

    const makeEngagement = async (start: string, end: string): Promise<string> => {
      await as(c, tenantId, manager!);
      const id = (await c.query('select engagement_create($1, $2, $3, $4, $5) as id', [clientId, start, end, partner, JSON.stringify({ riskFlags: [] })])).rows[0].id as string;
      for (const u of [senior!, staff!, qo!, eqr!]) await c.query('select engagement_add_member($1, $2)', [id, u]);
      return id;
    };
    const addItem = async (userId: string, engagementId: string, kind: string, title: string, content: object) => {
      await as(c, tenantId, userId);
      await c.query('insert into wp_items (tenant_id, engagement_id, kind, title, content, created_by) values ($1, $2, $3, $4, $5, $6)', [
        tenantId, engagementId, kind, title, JSON.stringify(content), userId,
      ]);
    };

    const prior = await makeEngagement('2025-01-01', '2025-12-31');
    await addItem(staff!, prior, 'trial_balance', 'Trial balance', asContent(TB_2025));
    await addItem(staff!, prior, 'fs_mapping', 'Statement mapping', asMapping(TB_2025));

    const current = await makeEngagement('2026-01-01', '2026-12-31');
    await addItem(staff!, current, 'trial_balance', 'Trial balance', asContent(TB_2026));
    await addItem(staff!, current, 'acceptance', 'Client acceptance and continuance', { notes: 'Long-standing client. Management integrity considered and no concerns noted.' });
    await addItem(staff!, current, 'engagement_letter', 'Engagement letter FY2026', { notes: 'Signed copy to be uploaded as evidence.' });
    await addItem(senior!, current, 'materiality', 'Materiality', { notes: 'Benchmark: revenue. Overall materiality 1%.' });
    await addItem(staff!, current, 'workpaper', 'Understanding the business', { notes: 'Wholesale trader of household goods in Nairobi with two outlets.' });

    await c.query('COMMIT');
    return true;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
