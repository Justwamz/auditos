import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { GRADE, type Role } from '@auditos/authz';
import { bootstrap, createPools, loadEnv, migrate } from '@auditos/db';
import { encrypt } from '../security/crypto';
import { hashPassword } from '../security/password';
import { generateSecret, otpauthUri } from '../security/totp';

const FIRMS = [
  { name: 'Demo Firm A', slug: 'firm-a' },
  { name: 'Demo Firm B', slug: 'firm-b' },
];
const ROLES: Role[] = ['firm_admin', 'partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr'];
export const CREDENTIALS_FILE = '.seed-credentials.local.json';

export interface SeededUser {
  email: string;
  role: Role;
  firm: string;
  totpSecret: string;
  otpauthUri: string;
}

/** Idempotent: existing tenants and users are left alone. Synthetic data only (@example.test). */
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
    for (const firm of FIRMS) {
      const c = await owner.connect();
      try {
        await c.query('BEGIN');
        let tenantId = (await c.query('select id from tenants where name = $1', [firm.name])).rows[0]?.id as string | undefined;
        tenantId ??= (await c.query('insert into tenants (name) values ($1) returning id', [firm.name])).rows[0].id as string;
        await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        for (const role of ROLES) {
          const email = `${role.replace('_', '-')}@${firm.slug}.example.test`;
          const existing = (await c.query('select id from users where lower(email) = $1', [email])).rows[0]?.id as string | undefined;
          if (existing) continue;
          const secret = generateSecret();
          const id = (
            await c.query(
              'insert into users (email, password_hash, mfa_secret_enc, mfa_enabled) values ($1, $2, $3, true) returning id',
              [email, passwordHash, encrypt(secret, env)],
            )
          ).rows[0].id as string;
          await c.query('insert into memberships (tenant_id, user_id, role, grade) values ($1, $2, $3, $4)', [tenantId, id, role, GRADE[role]]);
          users.push({ email, role, firm: firm.name, totpSecret: secret, otpauthUri: otpauthUri(secret, email, 'AuditOS') });
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
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
    writeFileSync(CREDENTIALS_FILE, JSON.stringify({ password, users }, null, 2));
    console.log(`Seeded ${users.length} users. Credentials written to ${CREDENTIALS_FILE} (git-ignored).`);
  }
}
