import type { Pool, PoolClient } from 'pg';
import { computeTotals } from '@auditos/fs-engine';
import { SimulationTaxProvider } from '../billing/providers';
import { timeValue } from '../billing/time';
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

const DEMO_MARK = 'Demo schedule';
const addDaysStr = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nairobiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const mondayOfDate = (date: string) => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysStr(date, dow === 0 ? -6 : 1 - dow);
};

/**
 * Idempotent. A pipeline spread across the team and a calendar for the current and next week, so the demo has something to
 * show for each profile. Calendar events are re-created when the last demo events are in the past. Returns what was added.
 */
export async function seedDemoPractice(owner: Pool, firmName = DEMO_FIRMS[0]!.name): Promise<{ prospects: number; events: number }> {
  const firm = DEMO_FIRMS.find((f) => f.name === firmName)!;
  const c = await owner.connect();
  const added = { prospects: 0, events: 0 };
  try {
    await c.query('BEGIN');
    const tenantId = (await c.query('select id from tenants where name = $1', [firmName])).rows[0]?.id as string | undefined;
    if (!tenantId) {
      await c.query('ROLLBACK');
      return added;
    }
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const emails: Record<string, string> = { ...Object.fromEntries(Object.entries(firm.people).map(([k, v]) => [k, v.email])), ...Object.fromEntries(firm.extra.map((x) => [x.key, x.email])) };
    const id: Record<string, string> = {};
    for (const [key, email] of Object.entries(emails)) {
      const row = (await c.query('select id from users where lower(email) = $1', [email.toLowerCase()])).rows[0];
      if (row) id[key] = row.id as string;
    }
    if (!id.partner || !id.manager || !id.staff || !id.manager2 || !id.partner2 || !id.senior || !id.staff2) {
      await c.query('ROLLBACK');
      return added;
    }

    // Pipeline: a few prospects per person, at different stages.
    await as(c, tenantId, id.partner);
    if ((await c.query('select count(*)::int as n from prospects')).rows[0].n === 0) {
      const prospects: { owner: string; name: string; sector: string; contact: string; fee: string; start: string; stage?: string; reason?: string; notes?: string }[] = [
        { owner: 'staff', name: 'Baraka Hauliers Ltd', sector: 'trading', contact: 'Hassan Omondi', fee: '38000000', start: '2027-01-15', notes: 'Referred by an existing client. Fleet of 12 trucks.' },
        { owner: 'senior', name: 'Zawadi Medical Centre', sector: 'consultancy', contact: 'Dr Ann Wekesa', fee: '62000000', start: '2027-02-01', stage: 'proposal', notes: 'Proposal sent on Monday. Wants a fixed fee.' },
        { owner: 'manager', name: 'Mlima Coffee Cooperative', sector: 'farming', contact: 'Josephine Kamau', fee: '95000000', start: '2027-01-05', stage: 'loe_sent', notes: 'Engagement letter with the board for signature.' },
        { owner: 'manager2', name: 'Tembo Apartments Ltd', sector: 'rental', contact: 'Vincent Okello', fee: '54000000', start: '2027-03-01' },
        { owner: 'staff2', name: 'Kito Logistics Ltd', sector: 'trading', contact: 'Salma Hussein', fee: '30000000', start: '2027-02-15' },
        { owner: 'manager2', name: 'Pwani Fisheries Ltd', sector: 'trading', contact: 'Mohamed Ali', fee: '41000000', start: '2027-01-10', stage: 'lost', reason: 'Chose a firm at the coast, closer to their office.' },
      ];
      for (const p of prospects) {
        await as(c, tenantId, id[p.owner]!);
        const pid = (await c.query('select prospect_create($1, $2, $3, $4, $5, $6, $7, $8) as id', [p.name, p.sector, p.contact, 'Demo data', id[p.owner], p.fee, p.start, p.notes ?? null])).rows[0].id as string;
        if (p.stage) await c.query('select prospect_set_stage($1, $2, $3)', [pid, p.stage, p.reason ?? null]);
        added.prospects += 1;
      }
    }

    // Calendar: replaced when the demo events have all passed.
    await as(c, tenantId, id.partner);
    const upcoming = (await c.query("select count(*)::int as n from calendar_events where notes = $1 and ends_at > now()", [DEMO_MARK])).rows[0].n as number;
    if (upcoming === 0) {
      const monday = mondayOfDate(nairobiToday());
      const eng = async (clientName: string, memberKey: string): Promise<string | null> => {
        await as(c, tenantId, id[memberKey]!);
        const r = await c.query('select e.id from engagements e join clients cl on cl.id = e.client_id where cl.name = $1 and e.period_end = $2', [clientName, '2026-12-31']);
        return (r.rows[0]?.id as string | undefined) ?? null;
      };
      const mwangaza = await eng('Mwangaza Traders Ltd', 'manager');
      const lakeview = await eng('Lakeview Rentals Ltd', 'manager');
      const savannah = await eng('Savannah Farms Ltd', 'manager2');
      type Ev = { by: string; title: string; kind: string; day: number; from: string; to: string; allDay?: boolean; days?: number; engagement?: string | null; with?: string[]; where?: string };
      const events: Ev[] = [
        { by: 'manager2', title: 'Pre-planning meeting: Savannah Farms', kind: 'meeting', day: 0, from: '09:00', to: '10:00', engagement: savannah, with: ['senior', 'partner2'], where: 'Boardroom' },
        { by: 'manager', title: 'Pre-audit meeting at Mwangaza Traders', kind: 'meeting', day: 1, from: '10:00', to: '12:00', engagement: mwangaza, with: ['staff', 'senior'], where: 'Client premises, Industrial Area' },
        { by: 'staff', title: 'Fieldwork: Mwangaza stock count', kind: 'fieldwork', day: 2, from: '08:00', to: '17:00', engagement: mwangaza, with: ['senior'], where: 'Client warehouse' },
        { by: 'manager', title: 'Fieldwork: Lakeview rent roll and leases', kind: 'fieldwork', day: 3, from: '09:00', to: '16:00', engagement: lakeview, with: ['staff'] },
        { by: 'partner2', title: 'Partner review: Savannah planning', kind: 'meeting', day: 2, from: '14:00', to: '15:30', with: ['manager2'] },
        { by: 'senior', title: 'ICPAK CPD: ISA 315 workshop', kind: 'training', day: 4, from: '09:00', to: '13:00', where: 'ICPAK, Nairobi' },
        { by: 'staff2', title: 'Annual leave', kind: 'leave', day: 3, from: '00:00', to: '23:59', allDay: true, days: 3 },
        { by: 'partner', title: 'Management meeting', kind: 'meeting', day: 7, from: '08:30', to: '09:30', with: ['manager', 'manager2', 'partner2'], where: 'Boardroom' },
        { by: 'manager', title: 'Mwangaza: draft financials due to partner', kind: 'deadline', day: 9, from: '17:00', to: '17:00', engagement: mwangaza },
      ];
      for (const e of events) {
        await as(c, tenantId, id[e.by]!);
        const date = addDaysStr(monday, e.day);
        const endDate = addDaysStr(date, (e.days ?? 1) - 1);
        await c.query('select calendar_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid[])', [
          e.title, e.kind, `${date}T${e.from}:00+03:00`, `${endDate}T${e.to}:00+03:00`, e.allDay ?? false, e.where ?? null, DEMO_MARK, null,
          e.engagement ?? null, (e.with ?? []).map((k) => id[k]!),
        ]);
        added.events += 1;
      }
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

/**
 * Idempotent. Rates, taxes, fees, a few weeks of time and expenses, invoices in different states and quotations, so the billing screens
 * have something to show for each profile. Skipped when rates already exist.
 */
export async function seedDemoBilling(owner: Pool, firmName = DEMO_FIRMS[0]!.name): Promise<boolean> {
  const firm = DEMO_FIRMS.find((f) => f.name === firmName)!;
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    const tenantId = (await c.query('select id from tenants where name = $1', [firmName])).rows[0]?.id as string | undefined;
    if (!tenantId) {
      await c.query('ROLLBACK');
      return false;
    }
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const emails: Record<string, string> = { ...Object.fromEntries(Object.entries(firm.people).map(([k, v]) => [k, v.email])), ...Object.fromEntries(firm.extra.map((x) => [x.key, x.email])) };
    const id: Record<string, string> = {};
    for (const [key, email] of Object.entries(emails)) {
      const row = (await c.query('select id from users where lower(email) = $1', [email.toLowerCase()])).rows[0];
      if (row) id[key] = row.id as string;
    }
    if (!id.partner || !id.manager || !id.manager2 || !id.partner2 || !id.senior || !id.staff) {
      await c.query('ROLLBACK');
      return false;
    }
    await as(c, tenantId, id.partner);
    if ((await c.query('select count(*)::int as n from billing_rates')).rows[0].n > 0) {
      await c.query('ROLLBACK');
      return false;
    }

    const engagementOf = async (clientName: string, as_: string): Promise<string | null> => {
      await as(c, tenantId, id[as_]!);
      return ((await c.query('select e.id from engagements e join clients cl on cl.id = e.client_id where cl.name = $1 and e.period_end = $2', [clientName, '2026-12-31'])).rows[0]?.id as string | undefined) ?? null;
    };
    const mwangaza = await engagementOf('Mwangaza Traders Ltd', 'manager');
    const lakeview = await engagementOf('Lakeview Rentals Ltd', 'manager');
    const savannah = await engagementOf('Savannah Farms Ltd', 'manager2');
    if (!mwangaza || !lakeview || !savannah) {
      await c.query('ROLLBACK');
      return false;
    }

    // Firm-wide: rates, taxes, invoice details.
    await as(c, tenantId, id.partner);
    for (const [role, rate] of [['partner', 900000], ['manager', 450000], ['senior', 250000], ['staff', 150000], ['quality_officer', 450000], ['eqr', 900000]] as const) {
      await c.query('insert into billing_rates (tenant_id, role, rate_cents) values ($1, $2, $3)', [tenantId, role, rate]);
    }
    const taxIds: Record<string, string> = {};
    for (const [name, bp, onPrev] of [['VAT', 1600, false], ['Excise duty', 1000, false], ['VAT on excise duty', 1600, true]] as const) {
      taxIds[name] = (await c.query('insert into tax_rates (tenant_id, name, rate_bp, on_previous) values ($1, $2, $3, $4) returning id', [tenantId, name, bp, onPrev])).rows[0].id as string;
    }
    await c.query(
      "insert into billing_settings (tenant_id, legal_name, address, kra_pin, bank_details, invoice_prefix, quote_prefix, payment_terms_days) values ($1, 'Kangethe & Associates', 'Kangethe House, Westlands, Nairobi', 'P051234567Q', 'Demo Bank, Westlands branch, account 0123456789 (demo)', 'KA', 'KQ', 14)",
      [tenantId],
    );

    // How each job is billed.
    for (const [eng, by, basis, flat, hours] of [[mwangaza, 'manager', 'flat', 48000000, 120], [lakeview, 'manager', 'hourly', null, 80], [savannah, 'manager2', 'flat', 35000000, 90]] as const) {
      await as(c, tenantId, id[by]!);
      await c.query('insert into engagement_fees (engagement_id, tenant_id, basis, flat_fee_cents, budget_hours) values ($1, $2, $3, $4, $5)', [eng, tenantId, basis, flat, hours]);
    }

    // Time: weekdays over the last three weeks.
    const today = nairobiToday();
    const weekday = (back: number) => {
      let d = addDaysStr(today, -back);
      while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysStr(d, -1);
      return d;
    };
    const plan: [string, string | null, number, number, string, boolean][] = [
      // who, engagement, days ago, minutes, what, billable
      ['staff', mwangaza, 21, 480, 'Stock count attendance and test counts', true],
      ['staff', mwangaza, 20, 450, 'Receivables confirmations and cut-off testing', true],
      ['senior', mwangaza, 20, 300, 'Review of stock count and receivables', true],
      ['manager', mwangaza, 19, 120, 'Planning review and client meeting', true],
      ['staff', mwangaza, 13, 420, 'Payables and accruals testing', true],
      ['senior', mwangaza, 12, 360, 'Revenue testing and analytical review', true],
      ['staff', lakeview, 11, 400, 'Rent roll and lease agreements', true],
      ['manager', lakeview, 10, 180, 'Review of rental income', true],
      ['staff', mwangaza, 6, 360, 'Fixed assets additions and depreciation', true],
      ['manager', mwangaza, 5, 150, 'Review of draft financial statements', true],
      ['senior', savannah, 5, 420, 'Planning: understanding the business and risks', true],
      ['manager2', savannah, 4, 240, 'Planning review', true],
      ['staff', lakeview, 3, 300, 'Bank reconciliations', true],
      ['senior', mwangaza, 2, 240, 'Going concern assessment', true],
      ['staff', null, 2, 120, 'Firm training: ISA 315 workshop', false],
      ['staff2', null, 1, 90, 'Firm meeting', false],
    ];
    const entryIds: Record<string, string[]> = { mwangazaOld: [] };
    for (const [who, eng, back, minutes, what, billable] of plan) {
      await as(c, tenantId, id[who]!);
      const r = await c.query(
        'insert into time_entries (tenant_id, engagement_id, work_date, minutes, description, billable) values ($1, $2, $3, $4, $5, $6) returning id',
        [tenantId, eng, weekday(back), minutes, what, billable],
      );
      if (eng === mwangaza && back >= 19) entryIds.mwangazaOld!.push(r.rows[0].id as string);
    }

    // Expenses on the jobs.
    for (const [who, eng, back, category, what, cents] of [['staff', mwangaza, 21, 'fuel', 'Fuel to the client warehouse, Industrial Area', 420000], ['manager', lakeview, 10, 'accommodation', 'Overnight stay for the Lakeview site visit', 1250000]] as const) {
      await as(c, tenantId, id[who]!);
      await c.query('insert into engagement_expenses (tenant_id, engagement_id, spent_on, category, description, amount_cents, rebillable) values ($1, $2, $3, $4, $5, $6, true)', [tenantId, eng, weekday(back), category, what, cents]);
    }

    // Invoices. Totals come from the same engine the application uses.
    const lineRow = (description: string, quantity: string, unit: bigint, amount: bigint, source: string, ids: string[]) => ({ description, quantity, unit, amount, source, ids });
    const insertInvoice = async (by: string, clientName: string, eng: string | null, mode: 'exclusive' | 'inclusive', taxes: string[], lines: ReturnType<typeof lineRow>[], notes: string | null): Promise<string> => {
      await as(c, tenantId, id[by]!);
      const clientId = (await c.query('select id from clients where name = $1', [clientName])).rows[0].id as string;
      const specs = taxes.map((name, i) => ({ name, rateBp: name === 'Excise duty' ? 1000 : 1600, onPrevious: i > 0 && name === 'VAT on excise duty' }));
      const t = computeTotals(lines.map((l) => ({ quantity: '1', unitCents: l.amount })), specs, mode);
      const invId = (
        await c.query(
          'insert into invoices (tenant_id, client_id, engagement_id, notes, tax_mode, taxes, subtotal_cents, tax_cents, total_cents, created_by) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) returning id',
          [tenantId, clientId, eng, notes, mode, JSON.stringify(t.taxes.map((x) => ({ name: x.name, rateBp: x.rateBp, onPrevious: x.onPrevious, amountCents: x.amountCents.toString() }))), t.subtotalCents.toString(), t.taxCents.toString(), t.totalCents.toString(), id[by]],
        )
      ).rows[0].id as string;
      let pos = 0;
      for (const l of lines) {
        await c.query('insert into invoice_lines (tenant_id, invoice_id, position, description, quantity, unit_cents, amount_cents, source, source_ids) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[])', [tenantId, invId, pos++, l.description, l.quantity, l.unit.toString(), l.amount.toString(), l.source, l.ids]);
      }
      return invId;
    };
    const issue = async (invId: string, by: string): Promise<void> => {
      await as(c, tenantId, id[by]!);
      const n = (await c.query('select number from invoice_issue($1, $2, $3)', [invId, 'KA', 14])).rows[0].number as string;
      const row = (await c.query("select i.total_cents::text as total, to_char(i.issue_date, 'YYYY-MM-DD') as issued, cl.name from invoices i join clients cl on cl.id = i.client_id where i.id = $1", [invId])).rows[0];
      const sim = await new SimulationTaxProvider().submit({ id: invId, tenantId, number: n, totalCents: BigInt(row.total), issueDate: row.issued, clientName: row.name, clientPin: null });
      await c.query('select invoice_set_etims($1, $2::jsonb)', [invId, JSON.stringify(sim)]);
    };

    // 1. Mwangaza: early-stage time and the fuel, billed, part paid.
    await as(c, tenantId, id.manager!);
    const billedTime = (await c.query('select t.id, t.user_id, coalesce(u.full_name, u.email) as name, t.minutes, t.rate_cents::text as rate from time_entries t join users u on u.id = t.user_id where t.id = any($1::uuid[])', [entryIds.mwangazaOld])).rows;
    const groups = new Map<string, { name: string; rate: bigint; minutes: number; amount: bigint; ids: string[] }>();
    for (const r of billedTime) {
      const k = `${r.user_id}|${r.rate}`;
      const g = groups.get(k) ?? { name: r.name as string, rate: BigInt(r.rate), minutes: 0, amount: 0n, ids: [] };
      g.minutes += r.minutes as number;
      g.amount += timeValue(r.minutes, g.rate);
      g.ids.push(r.id as string);
      groups.set(k, g);
    }
    const expenseRow = (await c.query("select id, amount_cents::text as amount, description from engagement_expenses where engagement_id = $1 and category = 'fuel'", [mwangaza])).rows[0];
    const lines1 = [...groups.values()].map((g) => lineRow(`Professional time: ${g.name}`, (g.minutes / 60).toFixed(3), g.rate, g.amount, 'time', g.ids));
    lines1.push(lineRow(`Expense (fuel): ${expenseRow.description}`, '1.000', BigInt(expenseRow.amount), BigInt(expenseRow.amount), 'expense', [expenseRow.id as string]));
    const inv1 = await insertInvoice('manager', 'Mwangaza Traders Ltd', mwangaza, 'exclusive', ['VAT'], lines1, 'Interim billing for the first phase of the FY2026 audit.');
    await issue(inv1, 'partner');
    await as(c, tenantId, id.partner);
    const total1 = BigInt((await c.query('select total_cents::text as t from invoices where id = $1', [inv1])).rows[0].t);
    await c.query('select invoice_record_payment($1, $2, $3, $4, $5)', [inv1, (total1 / 2n).toString(), weekday(8), 'bank', 'RTGS 20260918']);

    // 2. Lakeview: an instalment, VAT included in the price, now overdue.
    const inv2 = await insertInvoice('manager', 'Lakeview Rentals Ltd', lakeview, 'inclusive', ['VAT'], [lineRow('Audit fee: first instalment', '1.000', 17400000n, 17400000n, 'manual', [])], 'Instalment 1 of 3 under the engagement letter.');
    await issue(inv2, 'partner');
    await c.query("select set_config('app.invoicing', 'on', true)");
    await c.query("update invoices set due_date = (now() at time zone 'Africa/Nairobi')::date - 20, issue_date = (now() at time zone 'Africa/Nairobi')::date - 34 where id = $1", [inv2]);
    await c.query("select set_config('app.invoicing', 'off', true)");

    // 3. Savannah: a draft waiting for a partner to issue it.
    await insertInvoice('manager2', 'Savannah Farms Ltd', savannah, 'exclusive', ['VAT'], [lineRow('Audit fee (fixed): planning phase', '1.000', 10500000n, 10500000n, 'manual', [])], null);

    // Quotations: one sent to a prospect, one still a draft.
    const prospectId = async (name: string, by: string): Promise<string> => {
      await as(c, tenantId, id[by]!);
      return (await c.query('select id from prospects where name = $1', [name])).rows[0].id as string;
    };
    const quote = async (by: string, subject: { prospect?: string }, title: string, lines: [string, bigint][], taxes: string[], send: boolean): Promise<void> => {
      await as(c, tenantId, id[by]!);
      const specs = taxes.map((name) => ({ name, rateBp: 1600, onPrevious: false }));
      const t = computeTotals(lines.map(([, a]) => ({ quantity: '1', unitCents: a })), specs, 'exclusive');
      const qid = (
        await c.query(
          "insert into quotes (tenant_id, prospect_id, title, valid_until, tax_mode, taxes, subtotal_cents, tax_cents, total_cents, created_by) values ($1, $2, $3, (now() at time zone 'Africa/Nairobi')::date + 30, 'exclusive', $4::jsonb, $5, $6, $7, $8) returning id",
          [tenantId, subject.prospect, title, JSON.stringify(t.taxes.map((x) => ({ name: x.name, rateBp: x.rateBp, onPrevious: x.onPrevious, amountCents: x.amountCents.toString() }))), t.subtotalCents.toString(), t.taxCents.toString(), t.totalCents.toString(), id[by]],
        )
      ).rows[0].id as string;
      let pos = 0;
      for (const [d, a] of lines) await c.query('insert into quote_lines (tenant_id, quote_id, position, description, quantity, unit_cents, amount_cents) values ($1, $2, $3, $4, 1, $5, $5)', [tenantId, qid, pos++, d, a.toString()]);
      if (send) await c.query('select quote_send($1, $2)', [qid, 'KQ']);
    };
    const mlima = await prospectId('Mlima Coffee Cooperative', 'manager');
    await quote('manager', { prospect: mlima }, 'Statutory audit, year ending 31 December 2026', [['Statutory audit of the cooperative', 8500000n], ['Preparation of the tax computation', 1000000n]], ['VAT'], true);
    const tembo = await prospectId('Tembo Apartments Ltd', 'manager2');
    await quote('manager2', { prospect: tembo }, 'Audit and tax computation, FY2026', [['Statutory audit', 5400000n]], ['VAT'], false);

    await c.query('COMMIT');
    return true;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

const DEMO_STATEMENT_CSV = [
  'Date,Description,Debit,Credit,Balance',
  ',Balance brought forward,,,"100,000.00"',
  '02/03/2026,"ATM WITHDRAWAL WESTLANDS","5,000.00",,"95,000.00"',
  '03/03/2026,"SALARY MARCH ACME TRADERS LTD",,"150,000.00","245,000.00"',
  '05/03/2026,"CHEQUE 000123 JANE WANJIKU","20,000.00",,"225,000.00"',
  '10/03/2026,"MPESA PAYBILL 247247 KPLC","3,450.50",,"221,549.50"',
  '15/03/2026,"TRANSFER FROM MWANGAZA TRADERS",,"500,000.00","721,549.50"',
  '15/03/2026,"TRANSFER FROM MWANGAZA TRADERS",,"500,000.00","1,221,549.50"',
  '21/03/2026,"CASH DEPOSIT",,"75,000.00","1,296,549.50"',
  '28/03/2026,"CHEQUE 000124 RETURNED UNPAID","20,000.00",,"1,276,549.50"',
  '30/03/2026,"SUPPLIER PAYMENT KIPROP HARDWARE","1,100,000.00",,"176,549.50"',
  '31/03/2026,"BANK CHARGES","1,200.00",,"175,349.50"',
  ',Closing balance,,,"175,349.50"',
].join('\n');

/**
 * One synthetic bank statement (confirmed, so the analysis can be shown) and one sampling schedule with a few results,
 * on the Mwangaza engagement. Every name and figure is made up.
 */
export async function seedDemoAuditWork(owner: Pool, firmName = DEMO_FIRMS[0]!.name): Promise<boolean> {
  const { readStatement, checkIntegrity } = await import('@auditos/bank-statements');
  const { selectMonetaryUnit } = await import('@auditos/fs-engine');
  const { pack } = await import('../statements/store');
  const firm = DEMO_FIRMS.find((f) => f.name === firmName)!;
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    const tenantId = (await c.query('select id from tenants where name = $1', [firmName])).rows[0]?.id as string | undefined;
    if (!tenantId) {
      await c.query('ROLLBACK');
      return false;
    }
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const managerId = (await c.query('select id from users where lower(email) = $1', [firm.people.manager!.email.toLowerCase()])).rows[0]?.id as string | undefined;
    if (!managerId) {
      await c.query('ROLLBACK');
      return false;
    }
    await as(c, tenantId, managerId);
    const eng = (await c.query('select e.id from engagements e join clients cl on cl.id = e.client_id where cl.name = $1 and e.period_end = $2', [SYNTHETIC_CLIENT, '2026-12-31'])).rows[0]?.id as string | undefined;
    if (!eng || (await c.query('select 1 from bank_statements where engagement_id = $1', [eng])).rowCount) {
      await c.query('ROLLBACK');
      return false;
    }

    const parsed = await readStatement({ kind: 'csv', text: DEMO_STATEMENT_CSV });
    const integrity = checkIntegrity(parsed);
    const sid = (
      await c.query(
        `insert into bank_statements (tenant_id, engagement_id, filename, source, bank_name, account_last4, period_from, period_to, opening_cents, closing_cents, txn_count, integrity_status, integrity_messages, content_enc)
         values ($1, $2, 'demo-bank-statement-march.csv', 'csv', 'Demo Bank', '6789', '2026-03-01', '2026-03-31', $3, $4, $5, $6, '[]'::jsonb, $7) returning id`,
        [tenantId, eng, parsed.openingCents?.toString(), parsed.closingCents?.toString(), parsed.transactions.length, integrity.status, pack(parsed)],
      )
    ).rows[0].id as string;
    await c.query('update bank_statements set acknowledged_reason = null where id = $1', [sid]);

    // A sample of trade payables: 40 synthetic suppliers.
    const population = Array.from({ length: 40 }, (_, i) => ({ ref: `PINV-${String(i + 1).padStart(3, '0')}`, description: `Supplier ${i + 1} invoice`, amountCents: BigInt(150_000 + ((i * 7919) % 90) * 25_000) }));
    const total = population.reduce((a, p) => a + p.amountCents, 0n);
    const picked = selectMonetaryUnit(population, 8, 'demo-seed');
    const sch = (
      await c.query(
        `insert into sampling_schedules (tenant_id, engagement_id, title, objective, method, seed, requested_size, population_count, population_total_cents, population_hash, interval_cents)
         values ($1, $2, 'Trade payables at year end', 'Existence and completeness of payables', 'monetary_unit', 'demo-seed', 8, 40, $3, $4, $5) returning id`,
        [tenantId, eng, total.toString(), '0'.repeat(64), picked.intervalCents.toString()],
      )
    ).rows[0].id as string;
    const itemIds: string[] = [];
    for (const [position, s] of picked.selected.entries()) {
      const p = population[s.index]!;
      itemIds.push((await c.query('insert into sample_items (tenant_id, schedule_id, position, ref, description, amount_cents, reason) values ($1, $2, $3, $4, $5, $6, $7) returning id', [tenantId, sch, position + 1, p.ref, p.description, p.amountCents.toString(), s.reason])).rows[0].id as string);
    }
    await c.query("update sample_items set result = 'supported' where id = any($1::uuid[])", [itemIds.slice(0, 2)]);
    await c.query("update sample_items set result = 'exception', misstatement_cents = 250000, note = 'Invoice dated after year end; belongs to the next period' where id = $1", [itemIds[2]]);
    await c.query('COMMIT');
    return true;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
