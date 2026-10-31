import { defineConfig, devices } from '@playwright/test'

// End-to-end tests in e2e/. See e2e/README.md for running them and updating baselines.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFileName}/{arg}{ext}',

  timeout: 120_000,
  expect: {
    timeout: 15_000,
    toMatchSnapshot: {
      // Basemap labels and SwiftShader antialiasing move a few pixels between runs
      maxDiffPixelRatio: 0.01,
    },
  },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Headless Chromium has no GPU; same software WebGL as vitest.config.ts
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm start -- --port 5173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
