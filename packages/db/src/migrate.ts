import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { APP_ROLE, createSuperuserPool, OWNER_ROLE } from './pools';
import { requireEnv } from './env';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
const LOCK_KEY = 726_001;

/**
 * Creates the role with no special powers, or refreshes the password of an existing one. Existing roles are not
 * re-altered: changing SUPERUSER or BYPASSRLS needs a superuser, which hosted databases do not give you.
 */
export async function ensureRole(su: pg.Pool, name: string, password: string): Promise<void> {
  const exists = await su.query('select 1 from pg_roles where rolname = $1', [name]);
  const pw = pg.escapeLiteral(password);
  if (exists.rowCount === 0) {
    await su.query(`create role ${name} login nosuperuser nocreatedb nocreaterole nobypassrls password ${pw}`);
  } else {
    await su.query(`alter role ${name} with password ${pw}`);
  }
}

/** Creates roles, the database and extensions. Needs a role that may create roles (a local superuser, or a hosted database owner). */
export async function bootstrap(env: NodeJS.ProcessEnv): Promise<void> {
  const dbName = env.DB_NAME ?? 'auditos';
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error('invalid DB_NAME');
  const su = createSuperuserPool(env);
  try {
    await su.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureRole(su, OWNER_ROLE, requireEnv(env, 'OWNER_PASSWORD'));
    await ensureRole(su, APP_ROLE, requireEnv(env, 'APP_PASSWORD'));
    const db = await su.query('select 1 from pg_database where datname = $1', [dbName]);
    if (db.rowCount === 0) await su.query(`create database ${dbName} owner ${OWNER_ROLE}`);
    await su.query(`revoke all on database ${dbName} from public`);
    // A hosted database is created for us and owned by someone else, so the owner role needs connect explicitly too.
    await su.query(`grant connect on database ${dbName} to ${OWNER_ROLE}, ${APP_ROLE}`);
    await su.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
  } finally {
    await su.end();
  }
  const inDb = createSuperuserPool(env, dbName);
  try {
    await inDb.query('create extension if not exists pgcrypto');
    await inDb.query('revoke all on schema public from public');
    await inDb.query(`grant usage on schema public to ${APP_ROLE}`);
    await inDb.query(`grant all on schema public to ${OWNER_ROLE}`);
  } finally {
    await inDb.end();
  }
}

export async function migrate(owner: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const client = await owner.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name as string));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(resolve(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
