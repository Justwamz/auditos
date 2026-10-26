import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export const CREDS = resolve(__dirname, '.e2e-credentials.local.json');

/** Fresh database with synthetic users and the demo client every run. */
export default async function globalSetup(): Promise<void> {
  const root = resolve(__dirname, '..');
  execFileSync('node', ['reset-test-db.mjs', 'auditos_e2e'], { cwd: resolve(root, 'packages/db'), stdio: 'inherit' });
  const shell = process.platform === 'win32';
  execFileSync('pnpm', ['--filter', '@auditos/api', 'seed'], {
    cwd: root,
    stdio: 'inherit',
    shell,
    env: { ...process.env, DB_NAME: 'auditos_e2e', SEED_CREDENTIALS_FILE: CREDS },
  });
}
