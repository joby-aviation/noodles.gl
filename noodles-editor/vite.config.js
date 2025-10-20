import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'node:fs'
import path from 'node:path'

const ENV_VARIABLES_WITH_INSTRUCTIONS = {
  VITE_GOOGLE_MAPS_API_KEY: 'Get token at https://developers.google.com/maps/documentation/javascript/get-api-key',
  VITE_CESIUM_ACCESS_TOKEN: 'Get token at https://cesium.com/ion/tokens',
  VITE_MAPBOX_ACCESS_TOKEN: 'Get token at https://account.mapbox.com/access-tokens/',
  VITE_MAPTILER_API_KEY: 'Get token at https://cloud.maptiler.com/account/keys/',
  VITE_CLAUDE_API_KEY: 'Get token at https://console.anthropic.com/ (Optional - can be set in UI)',
}

// Log helpful messages for missing optional environment variables in development
if (process.env.NODE_ENV === 'development') {
  Object.entries(ENV_VARIABLES_WITH_INSTRUCTIONS).forEach(([key, instruction]) => {
    if (!process.env[key]) {
      console.log(`ℹ️  ${key} not set. ${instruction}`)
    }
  })
}

export default defineConfig(({ mode }) => {
  return {
    base: mode === 'development' ? '/' : '/app/',
    server: {
      open: true,
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

            // if it looks like a file request (has an extension)...
            if (/\.[a-zA-Z0-9]{1,8}$/.test(url)) {
              const safe = path.posix.normalize(url).replace(/^(\.\.[/\\])+/, '')

              const candidates = [
                publicDir && path.join(publicDir, safe),
                path.join(root, safe)
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
        }
      }
    ],
  }
})
