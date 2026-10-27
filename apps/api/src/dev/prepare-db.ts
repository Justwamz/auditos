import { seed } from './seed';
import { bootstrap, createPools, loadEnv, migrate } from '@auditos/db';

/**
 * Pre-deploy step for hosting: creates the application roles, then applies migrations as the owner role.
 * Safe to run on every deploy.
 */
loadEnv();
await bootstrap(process.env);
const { owner, app } = createPools(process.env);
try {
  const applied = await migrate(owner);
  console.log(applied.length === 0 ? 'Database is up to date.' : `Applied migrations: ${applied.join(', ')}`);
} finally {
  await owner.end();
  await app.end();
}

// Hosted demo only: SEED_DEMO=true adds the synthetic firms and users (idempotent; existing users are left alone).
if (process.env.SEED_DEMO === 'true') {
  const { users } = await seed({ ...process.env, ALLOW_SEED: 'true' });
  console.log(`Demo seed: ${users.length} new users.`);
}
