import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // Path to local deck.gl and luma.gl development directories
  const rootDir = path.join(__dirname, '../..')
  const deckglDir = path.join(rootDir, 'deck.gl')
  const lumaglDir = path.join(rootDir, 'luma.gl')

  // Aliases for local development packages
  const localAliases = {}

  // Check if local deck.gl exists and add aliases
  if (fs.existsSync(deckglDir)) {
    console.log('🔗 Using local deck.gl from', deckglDir)
    localAliases['deck.gl'] = path.join(deckglDir, 'modules/core/src')
    localAliases['@deck.gl/core'] = path.join(deckglDir, 'modules/core/src')
    localAliases['@deck.gl/layers'] = path.join(deckglDir, 'modules/layers/src')
    localAliases['@deck.gl/geo-layers'] = path.join(deckglDir, 'modules/geo-layers/src')
    localAliases['@deck.gl/aggregation-layers'] = path.join(deckglDir, 'modules/aggregation-layers/src')
    localAliases['@deck.gl/mesh-layers'] = path.join(deckglDir, 'modules/mesh-layers/src')
    localAliases['@deck.gl/extensions'] = path.join(deckglDir, 'modules/extensions/src')
  }

  // Check if local luma.gl exists and add aliases
  if (fs.existsSync(lumaglDir)) {
    console.log('🔗 Using local luma.gl from', lumaglDir)
    localAliases['@luma.gl/core'] = path.join(lumaglDir, 'modules/core/src')
    localAliases['@luma.gl/engine'] = path.join(lumaglDir, 'modules/engine/src')
    localAliases['@luma.gl/webgl'] = path.join(lumaglDir, 'modules/webgl/src')
    localAliases['@luma.gl/shadertools'] = path.join(lumaglDir, 'modules/shadertools/src')
  }

  // Get the base config and merge with local overrides
  const base = baseConfig({ mode })

  return mergeConfig(base, {
    resolve: {
      alias: localAliases
    }
  })
})
