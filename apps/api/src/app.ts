import { timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { createPools } from '@auditos/db';
import { authRoutes } from './auth/routes';
import { docControlRoutes } from './doc-control/routes';
import { engagementRoutes } from './engagements/routes';
import { tenantRoutes } from './tenants/routes';
import { loadConfig } from './config';
import { sha256Hex } from './security/crypto';
import type { AuthCtx } from './types';
import './types';

export interface AppOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  pools?: { app: Pool };
  /** Extra route plugins, registered after auth (feature modules). */
  routes?: Array<(app: FastifyInstance) => Promise<void>>;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? process.env;
  const cfg = loadConfig(env);
  const app = Fastify({
    logger:
      cfg.nodeEnv === 'test'
        ? false
        : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'] },
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  let ownedPool: Pool | undefined;
  if (opts.pools) {
    app.decorate('pools', opts.pools);
  } else {
    const { app: appPool, owner } = createPools(env);
    await owner.end();
    ownedPool = appPool;
    app.decorate('pools', { app: appPool });
  }
  app.decorate('cfg', cfg);
  app.decorate('now', opts.now ?? Date.now);
  app.addHook('onClose', async () => {
    await ownedPool?.end();
  });

  // Deny by default: every route must declare who may call it.
  app.addHook('onRoute', (route) => {
    const access = route.config?.access;
    if (access !== 'public' && access !== 'user' && access !== 'tenant') {
      throw new Error(`route ${String(route.method)} ${route.url} must declare config.access`);
    }
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: cfg.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.addHook('onRequest', async (req, reply) => {
    if (UNSAFE.has(req.method) && req.routeOptions.config?.csrf !== false) {
      const header = req.headers['x-csrf-token'];
      const stored = req.cookies.aos_csrf;
      if (typeof header !== 'string' || !stored || !safeEqual(header, stored)) {
        return reply.code(403).send({ error: 'csrf' });
      }
    }
    const access = req.routeOptions.config?.access;
    if (access !== 'user' && access !== 'tenant') return;

    const token = req.cookies.aos_session;
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    const r = await app.pools.app.query('select * from session_load($1, $2)', [sha256Hex(token), cfg.idleMinutes]);
    const row = r.rows[0];
    if (!row) return reply.code(401).send({ error: 'unauthenticated' });
    const auth: AuthCtx = {
      sessionId: row.session_id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      role: row.role,
      grade: row.grade,
      membershipActive: row.membership_active === true,
      stepUpAgeSec: row.stepup_age_seconds === null ? null : Number(row.stepup_age_seconds),
    };
    req.auth = auth;
    if (access === 'tenant' && (!auth.tenantId || !auth.membershipActive || !auth.role)) {
      return reply.code(403).send({ error: 'tenant_required' });
    }
    if (req.routeOptions.config?.stepUp) {
      const fresh = auth.stepUpAgeSec !== null && auth.stepUpAgeSec < cfg.stepUpMinutes * 60;
      if (!fresh) return reply.code(401).send({ error: 'step_up_required' });
    }
  });

  app.setErrorHandler((err: FastifyError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid_request', issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
    }
    const dbCode = (err as { code?: string }).code;
    if (typeof dbCode === 'string' && /^AO\d{3}$/.test(dbCode)) {
      return reply.code(Number(dbCode.slice(2))).send({ error: err.message });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: status === 429 ? 'rate_limited' : ((err as FastifyError).code ?? 'bad_request').toLowerCase() });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal' });
  });

  await app.register(authRoutes);
  await app.register(tenantRoutes);
  await app.register(engagementRoutes);
  await app.register(docControlRoutes);
  for (const plugin of opts.routes ?? []) await app.register(plugin);
  return app;
}
