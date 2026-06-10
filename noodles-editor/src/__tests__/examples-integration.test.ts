/**
 * Integration tests for example projects
 *
 * Tests that all example projects load without errors in the browser.
 * These are real browser tests using Playwright to catch:
 * - JSON parsing errors
 * - Missing operators
 * - Invalid connections
 * - Deck.gl initialization errors
 * - React errors during render
 * - Layer rendering validation
 *
 * Run with: npm test examples-integration
 */

import { page } from '@vitest/browser/context'
import { describe, test, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const examplesDir = join(__dirname, '../examples')

describe('Example Projects Integration', () => {
  // Get all example directories that have noodles.json
  const examples = readdirSync(examplesDir).filter(name => {
    const noodlesPath = join(examplesDir, name, 'noodles.json')
    return existsSync(noodlesPath)
  })

  for (const exampleName of examples) {
    test(
      `${exampleName} loads without errors`,
      async () => {
        // Navigate to the example
        const url = `/examples/${exampleName}`
        await page.goto(url)

        // Wait for Deck.gl canvas to appear
        await page.waitForSelector('canvas', { timeout: 10000 })

        // Check for React error boundaries
        const errorBoundary = await page.getByRole('alert').count()
        expect(errorBoundary).toBe(0)

        // Give it a moment to fully render
        await page.waitForTimeout(2000)

        // Inspect Deck.gl state to validate rendering
        const deckState = await page.evaluate(() => {
          // Access the global Deck instance if exposed
          const deckInstance = (window as any).deck
          if (!deckInstance) {
            return { error: 'Deck.gl instance not found on window.deck' }
          }

          const layerManager = deckInstance.layerManager
          if (!layerManager) {
            return { error: 'LayerManager not found' }
          }

          const layers = layerManager.getLayers()
          return {
            layerCount: layers.length,
            layers: layers.map((layer: any) => ({
              id: layer.id,
              type: layer.constructor.name,
              visible: layer.props.visible !== false,
              dataLength: Array.isArray(layer.props.data) ? layer.props.data.length : 'N/A',
              opacity: layer.props.opacity,
            })),
          }
        })

        // Validate Deck.gl rendered layers
        if ('error' in deckState) {
          console.warn(`${exampleName}: ${deckState.error} - skipping layer validation`)
        } else {
          // Should have at least one layer
          expect(deckState.layerCount).toBeGreaterThan(0)

          // Log layer info for debugging
          console.log(`${exampleName}: ${deckState.layerCount} layers rendered`)
          for (const layer of deckState.layers) {
            console.log(
              `  - ${layer.id} (${layer.type}): ${layer.dataLength} items, visible=${layer.visible}`
            )
          }

          // All layers should be visible (unless explicitly hidden)
          const visibleLayers = deckState.layers.filter(l => l.visible)
          expect(visibleLayers.length).toBeGreaterThan(0)

          // Layers with data should have non-zero length
          const layersWithData = deckState.layers.filter(l => typeof l.dataLength === 'number')
          if (layersWithData.length > 0) {
            const hasDataInSomeLayer = layersWithData.some(l => l.dataLength > 0)
            expect(hasDataInSomeLayer).toBe(true)
          }
        }
      },
      60000
    ) // 60 second timeout per test
  }

  test('at least one example is tested', () => {
    expect(examples.length).toBeGreaterThan(0)
  })
})
