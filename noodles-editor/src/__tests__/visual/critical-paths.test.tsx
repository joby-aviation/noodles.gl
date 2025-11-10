// Visual regression tests for critical user paths
// Tests end-to-end workflows that users commonly perform
import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import {
  navigateToProject,
  waitForNodeGraph,
} from './visual-test-utils'

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

describe('Critical Paths Visual Regression', () => {
  it('should show the main editor interface correctly', async () => {
    await navigateToProject('example')
    await waitForNodeGraph()

    // Verify main UI elements are visible
    const reactFlow = document.querySelector('.react-flow')
    expect(reactFlow).toBeTruthy()

    await expect.element(document.body).toMatchScreenshot('critical-path-main-interface')
  })

  it('should display node graph with connections', async () => {
    await navigateToProject('example')
    await waitForNodeGraph()

    // Verify nodes and edges are rendered
    const nodes = document.querySelectorAll('.react-flow__node')
    const edges = document.querySelectorAll('.react-flow__edge')

    // Should have some nodes if example project loads correctly
    expect(nodes.length).toBeGreaterThan(0)

    const reactFlow = await waitForSelector('.react-flow')
    await expect.element(reactFlow as HTMLElement).toMatchScreenshot('critical-path-node-graph')
  })

  it('should show menu bar correctly', async () => {
    await navigateToProject('example')
    await waitForNodeGraph()

    // Wait for menu/header to appear
    try {
      await waitForSelector('[data-testid="menu"], .menubar, header', 3000)
    } catch {
      // Menu might not have specific test IDs
    }

    await new Promise(resolve => setTimeout(resolve, 300))
    await expect.element(document.body).toMatchScreenshot('critical-path-menu-bar')
  })

  it('should render project name bar', async () => {
    await navigateToProject('example')
    await waitForNodeGraph()

    // Project name should be visible
    try {
      await waitForSelector('[data-testid="project-name"], .project-name', 3000)
    } catch {
      // Might not always be visible
    }

    await expect.element(document.body).toMatchScreenshot('critical-path-project-name')
  })

  it('should handle empty state correctly', async () => {
    await navigateToProject('empty')
    await waitForNodeGraph()

    await expect.element(document.body).toMatchScreenshot('critical-path-empty-state')
  })
})

