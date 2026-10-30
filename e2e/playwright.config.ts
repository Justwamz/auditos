import { defineConfig } from '@playwright/test';

// Isolated stack: own database (auditos_e2e) and ports, so the demo data on :3000 is never touched.
const API_PORT = 4110;
const WEB_PORT = 3100;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 360_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @auditos/api start',
      cwd: '..',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: String(API_PORT), DB_NAME: 'auditos_e2e', LOGIN_RATE_LIMIT: '1000', NODE_ENV: 'development' },
    },
    {
      command: `pnpm --filter @auditos/web exec next dev -p ${WEB_PORT}`,
      cwd: '..',
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      // NEXT_PUBLIC_SW is for testing only: it lets the dev server register the worker (production always does).
      env: { API_URL: `http://localhost:${API_PORT}`, NEXT_PUBLIC_SW: '1' },
    },
  ],
});
