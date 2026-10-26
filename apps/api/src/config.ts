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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = (env.NODE_ENV as Config['nodeEnv'] | undefined) ?? 'development';
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
  };
}
