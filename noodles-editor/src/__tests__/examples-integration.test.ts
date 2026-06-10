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
 * - Visual regression (screenshot comparison)
 * - Animation frame testing
 *
 * Run with: npm test examples-integration
 * Update snapshots: npm test examples-integration -- -u
 */

import { page } from '@vitest/browser/context'
import { describe, test, expect, beforeAll } from 'vitest'
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const examplesDir = join(__dirname, '../examples')
const snapshotsDir = join(__dirname, '__snapshots__')

// Examples that have animation (keyframes in timeline)
const ANIMATED_EXAMPLES = ['world-flights', 'cesium-hubble']

// Test frames for animated examples (in seconds)
const TEST_FRAMES = [0, 0.5, 1.0, 2.0]

beforeAll(() => {
  // Ensure snapshots directory exists
  if (!existsSync(snapshotsDir)) {
    mkdirSync(snapshotsDir, { recursive: true })
  }
})

describe('Example Projects Integration', () => {
  // Get all example directories that have noodles.json
  const examples = readdirSync(examplesDir).filter(name => {
    const noodlesPath = join(examplesDir, name, 'noodles.json')
    return existsSync(noodlesPath)
  })

  for (const exampleName of examples) {
    const isAnimated = ANIMATED_EXAMPLES.includes(exampleName)

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

        // Visual regression test - take screenshot and compare
        await testVisualRegression(exampleName, 'initial')

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
            await testVisualRegression(exampleName, `frame-${time}s`)
          }
        }
      },
      90000
    ) // 90 second timeout for data loading
  }

  test('at least one example is tested', () => {
    expect(examples.length).toBeGreaterThan(0)
  })
})

/**
 * Test visual regression by comparing screenshot to baseline
 */
async function testVisualRegression(exampleName: string, label: string) {
  const snapshotName = `${exampleName}-${label}.png`
  const snapshotPath = join(snapshotsDir, snapshotName)

  // Take screenshot of canvas only
  const screenshot = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')
    if (!canvas) throw new Error('Canvas not found')

    return new Promise<string>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('Failed to create blob from canvas'))
          return
        }
        const reader = new FileReader()
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            // Return base64 without data URL prefix
            resolve(reader.result.split(',')[1])
          } else {
            reject(new Error('Failed to read blob'))
          }
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    })
  })

  // Decode base64 to buffer
  const screenshotBuffer = Buffer.from(screenshot, 'base64')
  const screenshotPng = PNG.sync.read(screenshotBuffer)

  // Check if baseline exists
  if (!existsSync(snapshotPath)) {
    // No baseline - create one
    writeFileSync(snapshotPath, screenshotBuffer)
    console.log(`  ✓ Created baseline snapshot: ${snapshotName}`)
    return
  }

  // Load baseline
  const baselineBuffer = readFileSync(snapshotPath)
  const baselinePng = PNG.sync.read(baselineBuffer)

  // Compare dimensions
  if (
    screenshotPng.width !== baselinePng.width ||
    screenshotPng.height !== baselinePng.height
  ) {
    throw new Error(
      `Screenshot dimensions (${screenshotPng.width}x${screenshotPng.height}) don't match baseline (${baselinePng.width}x${baselinePng.height})`
    )
  }

  // Compare pixels
  const diffPng = new PNG({ width: screenshotPng.width, height: screenshotPng.height })
  const numDiffPixels = pixelmatch(
    screenshotPng.data,
    baselinePng.data,
    diffPng.data,
    screenshotPng.width,
    screenshotPng.height,
    {
      threshold: 0.1, // Slightly tolerant to anti-aliasing differences
      alpha: 0.1,
      diffColor: [255, 0, 0],
    }
  )

  const totalPixels = screenshotPng.width * screenshotPng.height
  const diffPercentage = (numDiffPixels / totalPixels) * 100

  // Allow up to 2% difference (for anti-aliasing, floating point precision, map tile loading)
  const DIFF_THRESHOLD = 2.0

  if (diffPercentage > DIFF_THRESHOLD) {
    // Write diff image for inspection
    const diffPath = join(snapshotsDir, `${exampleName}-${label}-diff.png`)
    const actualPath = join(snapshotsDir, `${exampleName}-${label}-actual.png`)
    writeFileSync(diffPath, PNG.sync.write(diffPng))
    writeFileSync(actualPath, screenshotBuffer)

    throw new Error(
      `Visual regression failed for ${snapshotName}: ${diffPercentage.toFixed(2)}% pixels differ (threshold: ${DIFF_THRESHOLD}%). ` +
        `Diff saved to ${diffPath}`
    )
  }

  console.log(`  ✓ Visual regression passed: ${snapshotName} (${diffPercentage.toFixed(4)}% diff)`)
}
