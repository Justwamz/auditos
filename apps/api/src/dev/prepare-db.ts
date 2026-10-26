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
