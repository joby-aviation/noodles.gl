/**
 * Visual Regression Tests for Example Projects
 *
 * These are true E2E tests using Playwright that:
 * - Navigate to each example
 * - Wait for data to load
 * - Validate Deck.gl rendering
 * - Take screenshots for visual regression
 * - Test animation frames
 *
 * Run with: npx playwright test examples-visual-regression
 * Update snapshots: npx playwright test examples-visual-regression --update-snapshots
 */

import { test, expect, type Page } from '@playwright/test'

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

test.describe('Example Projects Visual Regression', () => {
  for (const exampleName of EXAMPLES) {
    const isAnimated = ANIMATED_EXAMPLES.includes(exampleName)

    test(
      `${exampleName} renders correctly`,
      async ({ page }) => {
        // Navigate to the example
        await page.goto(`/examples/${exampleName}`)

        // Wait for Deck.gl canvas to appear
        await page.waitForSelector('canvas', { timeout: 10000 })

        // Check for React error boundaries
        const errorBoundary = await page.locator('[role="alert"]').count()
        expect(errorBoundary).toBe(0)

        // Wait for data to load - poll until layers have data
        await page.waitForFunction(
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

        // Wait a bit more for map tiles to load
        await page.waitForTimeout(2000)

        // Inspect Deck.gl state to validate rendering
        const deckState = await page.evaluate(() => {
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

        // Take screenshot for visual regression
        const canvas = page.locator('canvas').first()
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
      { timeout: 90000 }
    ) // 90 second timeout for data loading
  }
})
