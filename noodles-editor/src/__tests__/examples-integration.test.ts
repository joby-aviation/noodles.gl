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
 * - Visual regression (screenshot comparison via Playwright)
 * - Animation frame testing
 *
 * Run with: npm test examples-integration
 * Update snapshots: npm test examples-integration -- -u
 */

import { page } from 'vitest/browser'
import { describe, test, expect } from 'vitest'

// Examples that have animation (keyframes in timeline)
const ANIMATED_EXAMPLES = ['world-flights', 'cesium-hubble']

// Test frames for animated examples (in seconds)
const TEST_FRAMES = [0, 0.5, 1.0, 2.0]

// List of examples to test
const EXAMPLES = [
  '3d-building-gradient',
  'aggregation-example',
  'california-earthquakes',
  'cesium-hubble',
  'chargers',
  'custom-maplibre-layer-test',
  'geojson-example',
  'icon-layer-test',
  'nyc-census',
  'nyc-taxis',
  'orbit',
  'sf-elevation-contours',
  'sf-street-trees',
  'simple-mesh-example',
  'uk-commute',
  'us-county-unemployment',
  'world-flights',
]

describe('Example Projects Integration', () => {
  for (const exampleName of EXAMPLES) {
    const isAnimated = ANIMATED_EXAMPLES.includes(exampleName)

    test(
      `${exampleName} loads without errors`,
      async () => {
        // Navigate to the example
        const url = `/examples/${exampleName}`
        await page.goto(url)

        // Wait for Deck.gl canvas to appear
        const canvas = page.getByRole('img', { includeHidden: true }).first()
        await canvas.waitFor({ state: 'attached', timeout: 10000 })

        // Check for React error boundaries
        const errorBoundary = page.getByRole('alert')
        const errorCount = await errorBoundary.count()
        expect(errorCount).toBe(0)

        // Give it a moment to fully render
        await page.waitForTimeout(2000)

        // Wait for data to load - poll until layers have data
        const hasData = await page.evaluate(
          () => {
            const deckInstance = (window as any).deck
            if (!deckInstance?.layerManager) return false

            const layers = deckInstance.layerManager.getLayers()
            if (layers.length === 0) return false

            // Check if at least one layer has loaded data
            return layers.some((layer: any) => {
              const data = layer.props.data
              if (Array.isArray(data) && data.length > 0) return true
              // Some layers use data that's not arrays (e.g., TileLayer, TerrainLayer)
              if (data && typeof data === 'object') return true
              return false
            })
          },
          { timeout: 15000 }
        )

        expect(hasData).toBe(true)

        // Wait a bit more for map tiles to load
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
          throw new Error(`${exampleName}: ${deckState.error}`)
        }

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

        // Take screenshot for visual regression (Playwright handles snapshot comparison)
        await expect(canvas).toHaveScreenshot(`${exampleName}-initial.png`, {
          maxDiffPixels: 100, // Allow some anti-aliasing differences
        })

        // For animated examples, test multiple frames
        if (isAnimated) {
          for (const time of TEST_FRAMES) {
            // Seek to specific time in timeline
            await page.evaluate((seekTime: number) => {
              const getTimelineStore = (window as any).getTimelineStore
              if (getTimelineStore) {
                const store = getTimelineStore()
                store.setPosition(seekTime)
              }
            }, time)

            // Wait for render and data loading
            await page.waitForTimeout(1000)

            // Take screenshot at this frame
            await expect(canvas).toHaveScreenshot(`${exampleName}-frame-${time}s.png`, {
              maxDiffPixels: 100,
            })
          }
        }
      },
      90000
    ) // 90 second timeout for data loading
  }

  test('at least one example is tested', () => {
    expect(EXAMPLES.length).toBeGreaterThan(0)
  })
})
