import type { Pool, PoolClient } from 'pg';
import { encrypt } from '../security/crypto';
import { DEMO_FIRMS } from './people';

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
export async function seedDemoData(owner: Pool, firmName = DEMO_FIRMS[0]!.name): Promise<boolean> {
  const firm = DEMO_FIRMS.find((f) => f.name === firmName)!;
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    const tenantId = (await c.query('select id from tenants where name = $1', [firmName])).rows[0]?.id as string | undefined;
    if (!tenantId) throw new Error('Seed the demo firm first');
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const user = async (role: keyof typeof firm.people): Promise<string> =>
      (await c.query('select id from users where lower(email) = $1', [firm.people[role].email])).rows[0].id as string;
    const ids: string[] = [];
    for (const role of ['partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'] as const) ids.push(await user(role));
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
        "insert into clients (tenant_id, name, sector, legal_form, framework, year_end_month, created_by, account_manager_id) values ($1, $2, 'trading', 'Limited company', 'IFRS_SME', 12, $3, $3) returning id",
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

const DEMO_CONTACTS = [
  { name: 'Jane Wambui', position: 'Finance manager', phone: '+254 712 345 678', email: 'jane.wambui@mwangaza.example.test', idNumber: '27654321', kraPin: 'A012345678B' },
  { name: 'Peter Njoroge', position: 'Director', phone: '0722 111 222', email: 'peter.njoroge@mwangaza.example.test', idNumber: '12345678', kraPin: 'A098765432C' },
];

/** Idempotent. Fake people with fake details, stored encrypted like real ones. Returns true when it added them. */
export async function seedDemoContacts(owner: Pool, env: NodeJS.ProcessEnv, firmName = DEMO_FIRMS[0]!.name): Promise<boolean> {
  const firm = DEMO_FIRMS.find((f) => f.name === firmName)!;
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    const tenantId = (await c.query('select id from tenants where name = $1', [firmName])).rows[0]?.id as string | undefined;
    const manager = (await c.query('select id from users where lower(email) = $1', [firm.people.manager.email])).rows[0]?.id as string | undefined;
    if (!tenantId || !manager) {
      await c.query('ROLLBACK');
      return false;
    }
    await as(c, tenantId, manager);
    const client = (await c.query('select id from clients where name = $1', [SYNTHETIC_CLIENT])).rows[0]?.id as string | undefined;
    if (!client || (await c.query('select 1 from client_contacts where client_id = $1', [client])).rowCount) {
      await c.query('ROLLBACK');
      return false;
    }
    for (const p of DEMO_CONTACTS) {
      await c.query(
        'insert into client_contacts (tenant_id, client_id, name, position, phone_enc, email_enc, id_number_enc, kra_pin_enc, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [tenantId, client, p.name, p.position, encrypt(p.phone, env), encrypt(p.email, env), encrypt(p.idNumber, env), encrypt(p.kraPin, env), manager],
      );
    }
    await c.query('COMMIT');
    return true;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

interface PortfolioClient {
  name: string;
  sector: string;
  legalForm: string;
  /** Who is accountable for the client (a manager or partner). */
  accountManager: string;
  /** Who creates the engagement, and who signs as engagement partner. */
  creator: string;
  partner: string;
  team: string[];
  note: string;
}

/** Keys: the base roles (partner, manager, senior, staff, quality_officer, eqr) and the extras (partner2, manager2, staff2). */
const PORTFOLIO: PortfolioClient[] = [
  { name: 'Savannah Farms Ltd', sector: 'farming', legalForm: 'Limited company', accountManager: 'manager2', creator: 'manager2', partner: 'partner2', team: ['senior'], note: 'Horticulture exporter in Naivasha. Ruth manages the relationship; Charles is the engagement partner.' },
  { name: 'Lakeview Rentals Ltd', sector: 'rental', legalForm: 'Limited company', accountManager: 'partner', creator: 'partner', partner: 'partner', team: ['manager', 'staff'], note: 'Residential rental portfolio in Kilimani. Grace manages the relationship herself, with Daniel and Brian on the team.' },
  { name: 'Umoja Staff Pension Scheme', sector: 'pension', legalForm: 'Trust', accountManager: 'manager2', creator: 'manager2', partner: 'partner2', team: [], note: 'Retirement benefits scheme. Ruth and Charles only.' },
];

/**
 * Idempotent. Extra synthetic clients so every profile sees something different: who sees all clients, only their own,
 * their team's, or none. Returns the number of clients added.
 */
export async function seedDemoPortfolio(owner: Pool, firmName = DEMO_FIRMS[0]!.name): Promise<number> {
  const firm = DEMO_FIRMS.find((f) => f.name === firmName)!;
  const c = await owner.connect();
  let added = 0;
  try {
    await c.query('BEGIN');
    const tenantId = (await c.query('select id from tenants where name = $1', [firmName])).rows[0]?.id as string | undefined;
    if (!tenantId) {
      await c.query('ROLLBACK');
      return 0;
    }
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const emails: Record<string, string> = { ...Object.fromEntries(Object.entries(firm.people).map(([k, v]) => [k, v.email])), ...Object.fromEntries(firm.extra.map((x) => [x.key, x.email])) };
    const ids: Record<string, string> = {};
    for (const [key, email] of Object.entries(emails)) {
      const id = (await c.query('select id from users where lower(email) = $1', [email.toLowerCase()])).rows[0]?.id as string | undefined;
      if (id) ids[key] = id;
    }
    if (!ids.partner2 || !ids.manager2) {
      await c.query('ROLLBACK');
      return 0;
    }
    // Everyone who will be on a team has declared independence.
    for (const key of Object.keys(ids)) {
      if (key === 'firm_admin') continue;
      await as(c, tenantId, ids[key]!);
      await c.query(
        "insert into independence_declarations (tenant_id, user_id, statement) select $1, $2, 'Synthetic demo declaration: no relationships that impair independence.' where not exists (select 1 from independence_declarations where user_id = $2 and engagement_id is null)",
        [tenantId, ids[key]],
      );
    }
    for (const p of PORTFOLIO) {
      await as(c, tenantId, ids[p.creator]!);
      if ((await c.query('select 1 from clients where name = $1', [p.name])).rowCount) continue;
      const clientId = (
        await c.query(
          'insert into clients (tenant_id, name, sector, legal_form, framework, year_end_month, created_by, account_manager_id) values ($1, $2, $3, $4, $5, 12, $6, $7) returning id',
          [tenantId, p.name, p.sector, p.legalForm, 'IFRS_SME', ids[p.creator], ids[p.accountManager]],
        )
      ).rows[0].id as string;
      const eng = (
        await c.query('select engagement_create($1, $2, $3, $4, $5) as id', [clientId, '2026-01-01', '2026-12-31', ids[p.partner], JSON.stringify({ riskFlags: [] })])
      ).rows[0].id as string;
      for (const m of p.team) await c.query('select engagement_add_member($1, $2)', [eng, ids[m]]);
      await as(c, tenantId, ids[p.creator]!);
      for (const [kind, title, content] of [
        ['acceptance', 'Client acceptance and continuance', { notes: p.note }],
        ['workpaper', 'Understanding the business', { notes: p.note }],
      ] as const) {
        await c.query('insert into wp_items (tenant_id, engagement_id, kind, title, content, created_by) values ($1, $2, $3, $4, $5, $6)', [
          tenantId, eng, kind, title, JSON.stringify(content), ids[p.creator],
        ]);
      }
      added += 1;
    }
    await c.query('COMMIT');
    return added;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
