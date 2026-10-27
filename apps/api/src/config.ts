export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  isProd: boolean;
  webOrigin: string;
  idleMinutes: number;
  absoluteHours: number;
  stepUpMinutes: number;
  maxFailedLogins: number;
  lockMinutes: number;
  loginRateLimit: number;
  uploadDir: string;
  /** Number of trusted reverse proxies in front of the API (1 = the web app's proxy; Render adds one more). */
  trustProxyHops: number;
  /** Development only: a fixed six-digit code accepted instead of the authenticator. Never set outside development. */
  devFixedOtp?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = (env.NODE_ENV as Config['nodeEnv'] | undefined) ?? 'development';
  const devFixedOtp = env.DEV_FIXED_OTP || undefined;
  if (devFixedOtp !== undefined) {
    if (nodeEnv === 'production') throw new Error('DEV_FIXED_OTP must never be set in production');
    if (!/^\d{6}$/.test(devFixedOtp)) throw new Error('DEV_FIXED_OTP must be exactly six digits');
  }
  return {
    nodeEnv,
    isProd: nodeEnv === 'production',
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:3000',
    idleMinutes: 30,
    absoluteHours: 12,
    stepUpMinutes: 5,
    maxFailedLogins: 5,
    lockMinutes: 15,
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT ?? 10),
    uploadDir: env.UPLOAD_DIR ?? './storage',
    trustProxyHops: Number(env.TRUST_PROXY_HOPS ?? 1),
    ...(devFixedOtp ? { devFixedOtp } : {}),
  };
}
