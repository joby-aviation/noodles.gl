import { defineConfig } from 'vitest/config'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  test: {
    setupFiles: ['src/setupTests.ts'],
    browser: {
      provider: 'playwright',
      enabled: true,
      headless: true,
      screenshotFailures: false,
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
