// Visual regression tests for the timeline editor
// Tests critical UI paths in the timeline/animation editor
import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { waitForTimeline } from './visual-test-utils'

// Helper to wait for an element to exist in the DOM
async function waitForSelector(selector: string, timeout: number = 10000): Promise<Element> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector)
    if (element) {
      return element
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Element with selector "${selector}" not found within ${timeout}ms`)
}

describe('Timeline Editor Visual Regression', () => {
  it('should render the timeline editor with example project', async () => {
    // Navigate to timeline view (adjust URL if timeline uses different route)
    await page.viewport(1280, 720)
    window.location.href = 'http://localhost:5173/timeline?project=example'

    // Wait for timeline-specific elements
    await waitForSelector('canvas, [data-deck-gl], .deckgl-overlay')
    await waitForTimeline()

    // Wait for visualization to render
    await new Promise(resolve => setTimeout(resolve, 1000))

    await expect.element(document.body).toMatchScreenshot('timeline-editor-initial-load')
  })

  it('should render visualization canvas correctly', async () => {
    await page.viewport(1280, 720)
    window.location.href = 'http://localhost:5173/timeline?project=example'

    const canvas = await waitForSelector('canvas')
    await new Promise(resolve => setTimeout(resolve, 1000)) // Wait for WebGL to render

    // Screenshot just the canvas area
    await expect.element(canvas as HTMLElement).toMatchScreenshot('timeline-editor-canvas')
  })

  it('should show Theatre.js UI panels correctly', async () => {
    await page.viewport(1280, 720)
    window.location.href = 'http://localhost:5173/timeline?project=example'

    try {
      await waitForSelector('[data-theatre-id]', 5000)
    } catch {
      // Theatre UI might not always be visible
    }
    await new Promise(resolve => setTimeout(resolve, 500))

    await expect.element(document.body).toMatchScreenshot('timeline-editor-theatre-ui')
  })
})

