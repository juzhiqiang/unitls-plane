import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  outputDir: 'artifacts/screenshots/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:3100',
  },
  webServer: {
    command: 'bun --cwd=apps/web run start -- -p 3100',
    url: 'http://127.0.0.1:3100/zh',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
