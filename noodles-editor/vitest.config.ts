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
      provider: playwright({
        launchOptions: {
          // Permit Chromium's software WebGL fallback for real-renderer tests; this does not force it.
          args: ['--enable-unsafe-swiftshader'],
        },
        contextOptions: {
          // MapLibre sizes its canvas from DPR, so pin browser raster dimensions in CI.
          deviceScaleFactor: 1,
        },
      }),
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
      'node:module',
    ],
  },
  plugins: [
    nodePolyfills({
      protocolImports: true,
    }),
  ],
})
