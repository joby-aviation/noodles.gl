import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // Path to local deck.gl and luma.gl development directories
  const rootDir = path.resolve(__dirname, '../..')
  const deckglDir = path.resolve(rootDir, 'deck.gl')
  const lumaglDir = path.resolve(rootDir, 'luma.gl')

  console.log('Root directory:', rootDir)
  console.log('Deck.gl directory:', deckglDir)
  console.log('Luma.gl directory:', lumaglDir)

  // Aliases for local development packages
  const localAliases = {}

  // Force React to use the noodles-editor version to avoid multiple React instances
  const noodlesEditorDir = path.resolve(__dirname)
  localAliases['react'] = path.resolve(noodlesEditorDir, 'node_modules/react')
  localAliases['react-dom'] = path.resolve(noodlesEditorDir, 'node_modules/react-dom')

  // Check if local deck.gl exists and add aliases
  if (fs.existsSync(deckglDir)) {
    console.log('🔗 Using local deck.gl from', deckglDir)
    // Use path.resolve to ensure absolute paths
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

    // Widgets - point to module root (not src) so stylesheet.css resolves correctly
    // The package.json exports "./stylesheet.css" as "./dist/stylesheet.css"
    // But in local dev, stylesheet.css is in src/
    localAliases['@deck.gl/widgets/stylesheet.css'] = path.resolve(deckglDir, 'modules/widgets/src/stylesheet.css')
    localAliases['@deck.gl/widgets'] = path.resolve(deckglDir, 'modules/widgets/src')

    console.log('  Example alias: @deck.gl/mapbox ->', localAliases['@deck.gl/mapbox'])
    console.log('  Widgets alias: @deck.gl/widgets ->', localAliases['@deck.gl/widgets'])
    console.log('  CSS alias: @deck.gl/widgets/stylesheet.css ->', localAliases['@deck.gl/widgets/stylesheet.css'])
  }

  // Check if local luma.gl exists and add aliases
  if (fs.existsSync(lumaglDir)) {
    console.log('🔗 Using local luma.gl from', lumaglDir)
    localAliases['@luma.gl/core'] = path.resolve(lumaglDir, 'modules/core/src')
    localAliases['@luma.gl/engine'] = path.resolve(lumaglDir, 'modules/engine/src')
    localAliases['@luma.gl/webgl'] = path.resolve(lumaglDir, 'modules/webgl/src')
    localAliases['@luma.gl/shadertools'] = path.resolve(lumaglDir, 'modules/shadertools/src')
    localAliases['@luma.gl/effects'] = path.resolve(lumaglDir, 'modules/effects/src')
  }

  // Get the base config and merge with local overrides
  const base = baseConfig({ mode })

  const fsAllowPaths = [
    path.resolve(__dirname, '../..'),
    rootDir,
    deckglDir,
    lumaglDir
  ]

  console.log('Vite fs.allow paths:', fsAllowPaths)

  return mergeConfig(base, {
    resolve: {
      alias: [
        // CSS must come first to match before the general @deck.gl/widgets alias
        { find: '@deck.gl/widgets/stylesheet.css', replacement: path.resolve(deckglDir, 'modules/widgets/src/stylesheet.css') },
        ...Object.entries(localAliases).map(([find, replacement]) => ({ find, replacement }))
      ]
    },
    server: {
      ...base.server,
      fs: {
        // Allow serving files from outside the project root
        strict: false,
        allow: fsAllowPaths
      },
      middlewares: []
    },
    optimizeDeps: {
      // Force include local packages in optimization
      include: Object.keys(localAliases)
    }
  })
})
