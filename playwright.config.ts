import { defineConfig, devices } from '@playwright/test';

// UI 截图验收：起 web 目标的 Vite dev server，用 Chromium 在 1920×992（home 画板尺寸）下截图。
export default defineConfig({
  testDir: 'tests/ui',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173/',
    viewport: { width: 1920, height: 992 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev --workspace frontend',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
