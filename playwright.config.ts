import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Desktop Gallery',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'Mobile Phone',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
