import { playwright } from '@vitest/browser-playwright'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['src/setupTests.ts'],
    browser: {
      provider: playwright(),
      enabled: true,
      headless: true,
      screenshotFailures: true,
      trace: 'on-first-retry', // Enable traces for failed tests
      instances: [
        { browser: 'chromium' },
      ],
    }
  },
  optimizeDeps: {
    include: [
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
      'react/jsx-dev-runtime',
      'node:path',
    ],
  },
  plugins: [
    nodePolyfills({
      protocolImports: true,
    }),
  ],
})
