/**
 * Visual Regression Tests for Example Projects
 *
 * These are true E2E tests using Playwright that:
 * - Dynamically discover all examples from the filesystem
 * - Navigate to each example
 * - Wait for data to load
 * - Validate Deck.gl rendering
 * - Take screenshots for visual regression
 * - Test animation frames for examples with keyframes
 *
 * Run with: npx playwright test examples-visual-regression
 * Update snapshots: npx playwright test examples-visual-regression --update-snapshots
 */

import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Test frames for animated examples (in seconds)
const TEST_FRAMES = [0, 0.5, 1.0, 2.0]

// Discover all examples from the filesystem
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const examplesDir = join(__dirname, '../examples')
const EXAMPLES = readdirSync(examplesDir).filter(name => {
  const noodlesPath = join(examplesDir, name, 'noodles.json')
  return existsSync(noodlesPath)
})

// Check if an example is animated by looking for keyframes in the project file
function isAnimated(exampleName: string): boolean {
  try {
    const noodlesPath = join(examplesDir, exampleName, 'noodles.json')
    const content = readFileSync(noodlesPath, 'utf-8')
    const project = JSON.parse(content)

    // Check if any nodes have keyframes
    if (project.nodes) {
      for (const node of project.nodes) {
        if (node.data?.keyframes && Object.keys(node.data.keyframes).length > 0) {
          return true
        }
      }
    }

    return false
  } catch {
    return false
  }
}

test.describe('Example Projects Visual Regression', () => {
  for (const exampleName of EXAMPLES) {
    const hasAnimation = isAnimated(exampleName)

    test(
      `${exampleName} renders correctly`,
      async ({ page }) => {
        // Navigate to the example
        await page.goto(`/examples/${exampleName}`, { waitUntil: 'networkidle' })

        // Wait for window.deck to be available and canvas to render
        await page.waitForFunction(() => {
          const canvas = document.querySelector('canvas')
          const deck = (window as any).deck
          return canvas !== null && deck !== undefined
        }, { timeout: 20000 })

        // Give it time to initialize layers and load data
        // Some examples take longer to set up the graph
        await page.waitForTimeout(5000)

        // Take screenshot for visual regression
        const canvas = page.locator('canvas').first()
        await expect(canvas).toHaveScreenshot(`${exampleName}-initial.png`, {
          maxDiffPixels: 100, // Allow some anti-aliasing differences
        })

        // For animated examples, test multiple frames
        if (hasAnimation) {
          console.log(`${exampleName}: Testing animation frames (has keyframes)`)

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
