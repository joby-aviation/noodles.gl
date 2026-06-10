import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for visual regression tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './src/__tests__',
  testMatch: '**/*.spec.ts',

  // Output directories (keep within noodles-editor)
  outputDir: './test-results',

  // Maximum time one test can run
  timeout: 90 * 1000,

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter to use
  reporter: 'html',

  // Shared settings for all projects
  use: {
    // Base URL for navigation (can be overridden via PLAYWRIGHT_BASE_URL env var)
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run local dev server before starting tests (unless PLAYWRIGHT_BASE_URL is set)
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm start',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
})
