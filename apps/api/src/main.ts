import { loadEnv } from '@auditos/db';
import { buildApp } from './app';
import { lockDueEngagements } from './engagements/service';

loadEnv();
const app = await buildApp();
const port = Number(process.env.PORT ?? 4010);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

// Locks engagements past their file-assembly deadline. Runs at start-up and hourly.
const lockJob = () =>
  lockDueEngagements(app.pools.app, new Date())
    .then((n) => n > 0 && app.log.info({ locked: n }, 'auto-locked engagements'))
    .catch((err) => app.log.error({ err }, 'auto-lock job failed'));
void lockJob();
setInterval(lockJob, 60 * 60 * 1000).unref();
