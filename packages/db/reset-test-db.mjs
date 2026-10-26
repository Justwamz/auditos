import pg from 'pg';
process.loadEnvFile(new URL('../../.env.local', import.meta.url));
const u = new URL(process.env.PG_SUPERUSER_URL);
const c = new pg.Client({ host: u.hostname, port: Number(u.port), user: u.username, password: decodeURIComponent(u.password), database: 'postgres' });
await c.connect();
await c.query('drop database if exists auditos_test with (force)');
await c.end();
console.log('auditos_test dropped');
