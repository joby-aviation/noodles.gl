import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const ENV_VARIABLES_WITH_INSTRUCTIONS = {
  VITE_GOOGLE_MAPS_API_KEY:
    'Get token at https://developers.google.com/maps/documentation/javascript/get-api-key',
  VITE_CESIUM_ACCESS_TOKEN: 'Get token at https://cesium.com/ion/tokens',
  VITE_MAPBOX_ACCESS_TOKEN: 'Get token at https://account.mapbox.com/access-tokens/',
  VITE_MAPTILER_API_KEY: 'Get token at https://cloud.maptiler.com/account/keys/',
  VITE_CLAUDE_API_KEY: 'Get token at https://console.anthropic.com/ (Optional - can be set in UI)',
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')

  // Log helpful messages for missing optional environment variables in development
  if (mode === 'development') {
    Object.entries(ENV_VARIABLES_WITH_INSTRUCTIONS).forEach(([key, instruction]) => {
      if (!env[key]) {
        console.log(`ℹ️  ${key} not set. ${instruction}`)
      }
    })
  }

  return {
    base: mode === 'development' ? '/' : '/app/',
    server: {
      open: true,
    },
    // duckdb-wasm bundles WASM + worker files that break Vite's dep optimization.
    // web-llm is excluded for the opposite reason: it is only ever reached through
    // a dynamic import, and pre-bundling it would pull tens of megabytes into the
    // dev server's dep cache for every user who never picks a local model.
    optimizeDeps: {
      exclude: ['@duckdb/duckdb-wasm', '@mlc-ai/web-llm'],
    },
    // Workers ship as ES modules rather than Vite's default IIFE. The WebLLM
    // worker's dependency graph code-splits, which an IIFE build cannot express,
    // and every worker this app creates is already declared `type: 'module'`.
    worker: {
      format: 'es',
    },
    plugins: [
      react(),
      nodePolyfills({
        protocolImports: true,
      }),
      {
        name: 'dev-asset-404',
        enforce: 'pre', // run before vite's history fallback
        configureServer(server) {
          const publicDir = server.config.publicDir
          const root = server.config.root

          server.middlewares.use((req, res, next) => {
            let url = req.url || '/'
            url = decodeURIComponent(url.split('?')[0])

            // let Vite handle its own virtual/internal paths and hoisted node_modules
            if (url.startsWith('/@') || url.startsWith('/node_modules/')) {
              next()
              return
            }

            // if it looks like a file request (has an extension)...
            if (/\.[a-zA-Z0-9]{1,8}$/.test(url)) {
              const safe = path.posix.normalize(url).replace(/^(\.\.[/\\])+/, '')

              const candidates = [
                publicDir && path.join(publicDir, safe),
                path.join(root, safe),
              ].filter(Boolean)

              const exists = candidates.some(p => fs.existsSync(p))
              if (!exists) {
                res.statusCode = 404
                res.end('Not found')
                return
              }
            }

            next()
          })
        },
      },
    ],
  }
})
