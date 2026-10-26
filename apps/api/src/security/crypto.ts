import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

function masterKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.APP_ENC_KEY;
  if (!raw) throw new Error('APP_ENC_KEY is required');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('APP_ENC_KEY must be 32 bytes, base64 encoded');
  return key;
}

const derive = (env: NodeJS.ProcessEnv, label: string): Buffer =>
  Buffer.from(hkdfSync('sha256', masterKey(env), Buffer.alloc(0), label, 32));

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', derive(env, 'field-encryption'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(blob: string, env: NodeJS.ProcessEnv = process.env): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad ciphertext');
  const d = createDecipheriv('aes-256-gcm', derive(env, 'field-encryption'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

const sign = (payload: string, env: NodeJS.ProcessEnv): string =>
  createHmac('sha256', derive(env, 'signed-tokens')).update(payload).digest('base64url');

/** Short-lived signed token, e.g. the MFA challenge or a download link. */
export function signToken(data: Record<string, unknown>, expiresAtMs: number, env: NodeJS.ProcessEnv = process.env): string {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: expiresAtMs })).toString('base64url');
  return `${payload}.${sign(payload, env)}`;
}

export function verifyToken<T extends Record<string, unknown>>(
  token: string,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
): (T & { exp: number }) | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, env));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T & { exp: number };
    return typeof data.exp === 'number' && data.exp > nowMs ? data : null;
  } catch {
    return null;
  }
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
