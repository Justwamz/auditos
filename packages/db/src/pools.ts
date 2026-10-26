import pg from 'pg';
import { requireEnv } from './env';

export type { Pool, PoolClient } from 'pg';

export const OWNER_ROLE = 'auditos_owner';
export const APP_ROLE = 'auditos_app';

function connection(env: NodeJS.ProcessEnv, user: string, password: string, database?: string): pg.PoolConfig {
  const base = new URL(requireEnv(env, 'PG_SUPERUSER_URL'));
  return {
    host: base.hostname,
    port: Number(base.port || 5432),
    user,
    password,
    database: database ?? env.DB_NAME ?? 'auditos',
    ssl: env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 10,
  };
}

export function createPools(env: NodeJS.ProcessEnv = process.env): { owner: pg.Pool; app: pg.Pool } {
  return {
    owner: new pg.Pool(connection(env, OWNER_ROLE, requireEnv(env, 'OWNER_PASSWORD'))),
    app: new pg.Pool(connection(env, APP_ROLE, requireEnv(env, 'APP_PASSWORD'))),
  };
}

export function createSuperuserPool(env: NodeJS.ProcessEnv, database = 'postgres'): pg.Pool {
  const base = new URL(requireEnv(env, 'PG_SUPERUSER_URL'));
  return new pg.Pool({
    ...connection(env, decodeURIComponent(base.username), decodeURIComponent(base.password), database),
    max: 2,
  });
}
