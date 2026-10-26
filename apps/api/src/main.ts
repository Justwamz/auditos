import { loadEnv } from '@auditos/db';
import { buildApp } from './app';

loadEnv();
const app = await buildApp();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
