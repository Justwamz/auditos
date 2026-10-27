import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { GRADE, type Role } from '@auditos/authz';
import { bootstrap, createPools, loadEnv, migrate } from '@auditos/db';
import { encrypt } from '../security/crypto';
import { hashPassword } from '../security/password';
import { generateSecret, otpauthUri } from '../security/totp';
import { seedDemoBilling, seedDemoContacts, seedDemoData, seedDemoPortfolio, seedDemoPractice } from './demo-data';
import { DEMO_FIRMS, legacyEmail } from './people';

const ROLES: Role[] = ['firm_admin', 'partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'];
export const CREDENTIALS_FILE = '.seed-credentials.local.json';

export interface SeededUser {
  fullName: string;
  email: string;
  role: Role;
  firm: string;
  totpSecret: string;
  otpauthUri: string;
}

/**
 * Idempotent. Synthetic data only (@example.test). Existing databases are updated in place: the firms and people
 * keep their data when they are renamed, and role-named accounts from earlier seeds become named people.
 */
export async function seed(env: NodeJS.ProcessEnv = process.env): Promise<{ password: string; users: SeededUser[] }> {
  if (env.NODE_ENV === 'production' && env.ALLOW_SEED !== 'true') {
    throw new Error('Refusing to seed in production without ALLOW_SEED=true');
  }
  await bootstrap(env);
  const { owner, app } = createPools(env);
  const password = env.SEED_PASSWORD ?? randomBytes(12).toString('base64url');
  const passwordHash = await hashPassword(password);
  const users: SeededUser[] = [];
  try {
    await migrate(owner);
    for (const firm of DEMO_FIRMS) {
      const c = await owner.connect();
      try {
        await c.query('BEGIN');
        let tenantId = (await c.query('select id from tenants where name = $1', [firm.name])).rows[0]?.id as string | undefined;
        const formerId = (await c.query('select id from tenants where name = $1', [firm.formerName])).rows[0]?.id as string | undefined;
        if (!tenantId && formerId) {
          await c.query("select set_config('app.tenant_id', $1, true)", [formerId]);
          await c.query('update tenants set name = $1 where id = $2', [firm.name, formerId]);
          tenantId = formerId;
        }
        tenantId ??= (await c.query('insert into tenants (name) values ($1) returning id', [firm.name])).rows[0].id as string;
        await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        const everyone = [
          ...ROLES.map((role) => ({ role, legacy: true, ...firm.people[role] })),
          ...firm.extra.map((x) => ({ role: x.role, legacy: false, fullName: x.fullName, email: x.email })),
        ];
        for (const { role, legacy, fullName, email } of everyone) {
          // Role-named accounts from earlier seeds (two address generations) become this named person.
          for (const old of legacy ? [legacyEmail(role, firm.formerSlug), legacyEmail(role, firm.slug)] : []) {
            await c.query(
              'update users set email = $1, full_name = $2 where lower(email) = $3 and not exists (select 1 from users where lower(email) = $1)',
              [email, fullName, old],
            );
          }
          const existing = (await c.query('select id from users where lower(email) = $1', [email])).rows[0]?.id as string | undefined;
          if (existing) {
            await c.query('update users set full_name = coalesce(full_name, $2) where id = $1', [existing, fullName]);
            continue;
          }
          const secret = generateSecret();
          const id = (
            await c.query(
              'insert into users (email, full_name, password_hash, mfa_secret_enc, mfa_enabled) values ($1, $2, $3, $4, true) returning id',
              [email, fullName, passwordHash, encrypt(secret, env)],
            )
          ).rows[0].id as string;
          await c.query('insert into memberships (tenant_id, user_id, role, grade, is_admin) values ($1, $2, $3, $4, $5)', [
            tenantId, id, role, GRADE[role], role === 'firm_admin',
          ]);
          users.push({ fullName, email, role, firm: firm.name, totpSecret: secret, otpauthUri: otpauthUri(secret, email, 'AuditOS') });
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
    const created = await seedDemoData(owner);
    if (created) console.log('Seeded a synthetic client with FY2025 and FY2026 engagements in Kangethe & Associates.');
    if (await seedDemoContacts(owner, env)) console.log('Seeded synthetic client contacts (personal details are fake and stored encrypted).');
    const portfolio = await seedDemoPortfolio(owner);
    if (portfolio > 0) console.log(`Seeded ${portfolio} more synthetic clients so each profile sees a different set.`);
    const practice = await seedDemoPractice(owner);
    if (practice.prospects + practice.events > 0) console.log(`Seeded ${practice.prospects} prospects and ${practice.events} calendar events.`);
    if (await seedDemoBilling(owner)) console.log('Seeded rates, taxes, fees, time, expenses, invoices and quotations.');
  } finally {
    await owner.end();
    await app.end();
  }
  return { password, users };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv();
  const { password, users } = await seed();
  if (users.length === 0) {
    console.log('Seed: nothing new to create (already seeded). Credentials file left as is.');
  } else {
    writeFileSync(process.env.SEED_CREDENTIALS_FILE ?? CREDENTIALS_FILE, JSON.stringify({ password, users }, null, 2));
    console.log(`Seeded ${users.length} users. Credentials written to ${process.env.SEED_CREDENTIALS_FILE ?? CREDENTIALS_FILE} (git-ignored).`);
  }
}
