import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'node:fs'
import path from 'node:path'

export default defineConfig(() => {
  return {
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
