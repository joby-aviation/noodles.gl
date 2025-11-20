// Vite configuration for local deck.gl and luma.gl development
//
// Aliases deck.gl and luma.gl imports to local source directories (../deck.gl, ../luma.gl)
// for rapid development iteration without needing to publish/link packages.
//
// Usage: yarn start:local
//
// Limitations:
// - @deck.gl/widgets uses npm package (CSS loading blocked by Vite 7 fs restrictions)
//   Vite 7 has stricter file serving rules that prevent loading CSS from outside
//   the project root, even with fs.allow configured. deck.gl examples use Vite 4
//   which was more permissive. All JS modules work, just not the CSS file.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(__dirname, '../..')
  const deckglDir = path.resolve(rootDir, 'deck.gl')
  const lumaglDir = path.resolve(rootDir, 'luma.gl')

  const localAliases = {}

  // Force React to use a single instance to avoid hook errors
  localAliases['react'] = path.resolve(__dirname, 'node_modules/react')
  localAliases['react-dom'] = path.resolve(__dirname, 'node_modules/react-dom')

  // deck.gl aliases
  if (fs.existsSync(deckglDir)) {
    console.log('🔗 Using local deck.gl from', deckglDir)
    // Point to src directory for JS/TS imports
    // deck.gl main package re-exports everything from all modules
    localAliases['deck.gl'] = path.resolve(deckglDir, 'modules/main/src')
    localAliases['@deck.gl/core'] = path.resolve(deckglDir, 'modules/core/src')
    localAliases['@deck.gl/layers'] = path.resolve(deckglDir, 'modules/layers/src')
    localAliases['@deck.gl/geo-layers'] = path.resolve(deckglDir, 'modules/geo-layers/src')
    localAliases['@deck.gl/aggregation-layers'] = path.resolve(deckglDir, 'modules/aggregation-layers/src')
    localAliases['@deck.gl/mesh-layers'] = path.resolve(deckglDir, 'modules/mesh-layers/src')
    localAliases['@deck.gl/extensions'] = path.resolve(deckglDir, 'modules/extensions/src')
    localAliases['@deck.gl/mapbox'] = path.resolve(deckglDir, 'modules/mapbox/src')
    localAliases['@deck.gl/react'] = path.resolve(deckglDir, 'modules/react/src')
    // Note: @deck.gl/widgets uses npm package (CSS loading issues with local source)
    // localAliases['@deck.gl/widgets'] = path.resolve(deckglDir, 'modules/widgets/src')
  }

  // luma.gl aliases
  if (fs.existsSync(lumaglDir)) {
    console.log('🔗 Using local luma.gl from', lumaglDir)
    localAliases['@luma.gl/core'] = path.resolve(lumaglDir, 'modules/core/src')
    localAliases['@luma.gl/engine'] = path.resolve(lumaglDir, 'modules/engine/src')
    localAliases['@luma.gl/webgl'] = path.resolve(lumaglDir, 'modules/webgl/src')
    localAliases['@luma.gl/shadertools'] = path.resolve(lumaglDir, 'modules/shadertools/src')
    localAliases['@luma.gl/effects'] = path.resolve(lumaglDir, 'modules/effects/src')
  }

  const base = baseConfig({ mode })

  return mergeConfig(base, {
    resolve: {
      alias: Object.entries(localAliases).map(([find, replacement]) => ({ find, replacement }))
    },
    server: {
      ...base.server,
      fs: {
        allow: [rootDir]
      }
    },
    optimizeDeps: {
      // Force include local packages in optimization
      include: Object.keys(localAliases)
    }
  })
})
