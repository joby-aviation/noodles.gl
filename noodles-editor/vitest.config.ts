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
      screenshotFailures: false,
      instances: [
        { browser: 'chromium' },
      ],
      api: {
        host: '127.0.0.1', // Use IPv4 instead of IPv6 to avoid EPERM issues
        strictPort: false, // Allow using alternative ports if the default is taken
      },
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
