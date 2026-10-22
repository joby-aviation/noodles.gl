import { playwright } from '@vitest/browser-playwright'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'browser',
          // e2e/ is the Playwright suite (playwright.config.ts)
          exclude: [...configDefaults.exclude, 'scripts/**', 'e2e/**'],
          setupFiles: ['src/setupTests.ts'],
          browser: {
            provider: playwright({
              // Software WebGL so shader tests can render in headless Chromium
              launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
            }),
            enabled: true,
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      // CLI scripts need real Node APIs (child processes, the file system)
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],
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
