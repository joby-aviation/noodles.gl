import { defineConfig, devices } from '@playwright/test'

// Visual regression tests in e2e/. See dev-docs/testing-guide.md for running them and
// updating baselines.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Baselines per platform: software WebGL and system fonts draw slightly differently on
  // macOS and Linux. Only the linux/ baselines, rendered by CI, are committed.
  snapshotPathTemplate: '{testDir}/__snapshots__/{platform}/{arg}{ext}',

  timeout: 180_000,
  expect: {
    toMatchSnapshot: {
      // Basemap label placement and SwiftShader antialiasing move a few pixels between runs
      maxDiffPixelRatio: 0.01,
    },
  },

  fullyParallel: true,
  // Each test draws a whole map in software WebGL; more than two at once starve each other
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        launchOptions: {
          // CI runners have no GPU; the same software WebGL as vitest.config.ts
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
