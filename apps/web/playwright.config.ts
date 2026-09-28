import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against a production build (`pnpm build` first). Uses the pre-installed
 * Chromium (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). No API is configured, so the
 * WebApp runs in offline demo mode and the admin console shows its explicit no-API state.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    permissions: [],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
