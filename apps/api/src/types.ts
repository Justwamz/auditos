import type { Pool } from 'pg';
import type { Role } from '@auditos/authz';
import type { Config } from './config';

export interface AuthCtx {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  role: Role | null;
  grade: number | null;
  membershipActive: boolean;
  stepUpAt: Date | null;
}

export type Access = 'public' | 'user' | 'tenant';

declare module 'fastify' {
  interface FastifyInstance {
    pools: { app: Pool };
    cfg: Config;
    now: () => number;
  }
  interface FastifyRequest {
    auth?: AuthCtx;
  }
  interface FastifyContextConfig {
    access?: Access;
    stepUp?: boolean;
  }
}
