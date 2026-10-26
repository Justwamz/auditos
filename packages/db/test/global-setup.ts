import { bootstrap, loadEnv, migrate, createPools } from '../src';

export default async function setup(): Promise<void> {
  loadEnv();
  process.env.DB_NAME = 'auditos_test';
  await bootstrap(process.env);
  const { owner, app } = createPools(process.env);
  await migrate(owner);
  await owner.end();
  await app.end();
}
