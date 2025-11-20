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
      instances: [
        { browser: 'chromium' },
      ],
      api: {
        host: '127.0.0.1', // Explicitly use IPv4 to avoid IPv6 permission issues
        strictPort: false, // Allow using alternative ports if the default is taken
      },
    }
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
