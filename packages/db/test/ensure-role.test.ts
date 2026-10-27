import { describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { ensureRole } from '../src/migrate';

/** Records the SQL sent, and answers "does the role exist" from a flag. */
function fakePool(exists: boolean): { pool: Pool; sql: string[] } {
  const sql: string[] = [];
  const pool = {
    query: async (text: string) => {
      sql.push(text);
      return { rowCount: text.startsWith('select 1 from pg_roles') ? (exists ? 1 : 0) : 0, rows: [] };
    },
  } as unknown as Pool;
  return { pool, sql };
}

describe('ensureRole works for a database login that can create roles but is not a superuser', () => {
  test('a new role is created without superuser, createdb, createrole or bypassrls', async () => {
    const { pool, sql } = fakePool(false);
    await ensureRole(pool, 'auditos_app', 'pw');
    const create = sql.find((s) => s.startsWith('create role'))!;
    expect(create).toMatch(/nosuperuser/);
    expect(create).toMatch(/nobypassrls/);
    expect(create).toMatch(/password 'pw'/);
  });

  test('an existing role only gets its password refreshed (changing role attributes needs a superuser)', async () => {
    const { pool, sql } = fakePool(true);
    await ensureRole(pool, 'auditos_app', 'pw');
    const alter = sql.find((s) => s.startsWith('alter role'))!;
    expect(alter).toMatch(/password 'pw'/);
    expect(alter).not.toMatch(/superuser/i);
    expect(alter).not.toMatch(/bypassrls/i);
    expect(sql.some((s) => s.startsWith('create role'))).toBe(false);
  });

  test('passwords with quotes are escaped', async () => {
    const { pool, sql } = fakePool(true);
    await ensureRole(pool, 'auditos_app', "p'w");
    expect(sql.find((s) => s.startsWith('alter role'))).toMatch(/password 'p''w'/);
  });
});
