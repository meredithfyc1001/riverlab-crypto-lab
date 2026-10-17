import { defineConfig, devices } from '@playwright/test';

const browser = process.env.E2E_BROWSER ?? 'chromium';
if (!['chromium', 'chrome', 'msedge'].includes(browser)) {
  throw new Error('E2E_BROWSER 仅支持 chromium、chrome、msedge。');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath:
        browser === 'chromium'
          ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          : undefined,
    },
  },
  projects: [
    {
      name: `${browser}-${process.platform}`,
      use: {
        ...devices['Desktop Chrome'],
        channel: browser === 'chromium' ? undefined : browser,
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
