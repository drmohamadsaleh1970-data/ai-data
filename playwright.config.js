import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

// E2E tests run against a local server seeded with fictional demo data. Never point
// them at production.
export default defineConfig({
  testDir: './e2e',
  // One worker: the specs share a single SQLite-backed server.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'node --no-warnings scripts/e2e-server.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
