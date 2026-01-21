import { playwright } from '@vitest/browser-playwright'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    setupFiles: ['src/setupTests.ts'],
    browser: {
      provider: playwright(),
      enabled: true,
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
  optimizeDeps: {
    include: [
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
      'react',
      'react-dom',
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
