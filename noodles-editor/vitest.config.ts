import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { configDefaults, defineConfig } from 'vitest/config'

// The planner is a workspace package; resolve it to source so an edit needs no build.
const plannerAlias = {
  '@noodles.gl/planner': fileURLToPath(
    new URL('../packages/planner/src/index.ts', import.meta.url)
  ),
  // deck's S2 cell outline, which its package does not export (as in vite.config.js)
  'deck-s2-utils': fileURLToPath(
    new URL('../node_modules/@deck.gl/geo-layers/dist/s2-layer/s2-utils.js', import.meta.url)
  ),
}

export default defineConfig({
  resolve: {
    alias: plannerAlias,
    dedupe: ['react', 'react-dom'],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'browser',
          exclude: [...configDefaults.exclude, 'scripts/**', '**/*.node.test.ts'],
          setupFiles: ['src/setupTests.ts'],
          browser: {
            provider: playwright({
              // Software WebGL so shader tests can render in headless Chromium
              launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
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
      },
      // CLI scripts need real Node APIs (child processes, the file system). Runtime tests run
      // real SQL through duckdb-wasm's Node build: no browser, and no node polyfills, which
      // would replace the `node:module` the Node build loads through.
      {
        resolve: { alias: plannerAlias },
        test: {
          name: 'node',
          environment: 'node',
          // These run real DuckDB queries over real example files: seconds each, more when the
          // machine is busy
          testTimeout: 30_000,
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
