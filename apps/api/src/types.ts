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
  isAdmin: boolean;
  stepUpAgeSec: number | null;
}

export type Access = 'public' | 'user' | 'tenant';

declare module 'fastify' {
  interface FastifyInstance {
    pools: { app: Pool };
    cfg: Config;
    now: () => number;
    blobs: import('./evidence/storage').BlobStore | undefined;
    scanner: import('./evidence/storage').Scanner | undefined;
  }
  interface FastifyRequest {
    auth?: AuthCtx;
  }
  interface FastifyContextConfig {
    access?: Access;
    stepUp?: boolean;
    /** Set false only for token-authenticated machine endpoints that carry no cookies. */
    csrf?: boolean;
  }
}
