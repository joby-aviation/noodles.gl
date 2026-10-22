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

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

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
        await page.waitForFunction(
          () => {
            const canvas = document.querySelector('canvas')
            const deck = (window as any).deck
            return canvas !== null && deck !== undefined
          },
          { timeout: 30000 }
        )

        // Wait for data to load and render
        // TODO: Hook into actual data loading state instead of fixed timeout
        // For now, use a generous timeout to handle slow external data
        await page.waitForTimeout(10000)

        // Take screenshot for visual regression
        // Captures the full React Flow viewport including both:
        // - The Deck.gl canvas (visualization output)
        // - The React Flow nodes (node editor UI)
        const reactFlowWrapper = page.locator('.react-flow-wrapper').first()
        await expect(reactFlowWrapper).toHaveScreenshot(`${exampleName}.png`, {
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

            // Wait for render
            await page.waitForTimeout(500)

            // Take screenshot at this frame
            const reactFlowWrapper = page.locator('.react-flow-wrapper').first()
            await expect(reactFlowWrapper).toHaveScreenshot(`${exampleName}-${time}s.png`, {
              maxDiffPixels: 100,
            })
          }
        }
      },
      { timeout: 150000 }
    ) // 150 second (2.5 min) timeout for slow data loading
  }
})
