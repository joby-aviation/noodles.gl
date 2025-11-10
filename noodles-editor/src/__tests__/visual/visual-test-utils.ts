// Utilities for visual regression testing
// Provides helpers for navigating to pages, waiting for elements, and taking screenshots
import { page } from 'vitest/browser'

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

// Navigate to the noodles editor with a specific project
export async function navigateToProject(projectName: string = 'nyc-taxis') {
  await page.viewport(1280, 720)
  window.location.href = `http://localhost:5173/?project=${projectName}`

  // Wait for the app to be ready
  await waitForSelector('[data-testid="noodles-app"], .react-flow-wrapper')
  // Give time for Theatre.js and other async initialization
  await new Promise(resolve => setTimeout(resolve, 1000))
}

// Wait for a specific element to be visible and stable
export async function waitForElement(selector: string, timeout: number = 5000) {
  const element = await waitForSelector(selector, timeout)
  // Wait a bit more for animations/rendering to complete
  await new Promise(resolve => setTimeout(resolve, 200))
  return element
}

// Take a screenshot of a specific element
export async function screenshotElement(selector: string, name: string) {
  const element = await waitForSelector(selector, 5000)
  await new Promise(resolve => setTimeout(resolve, 200)) // Wait for animations
  return await page.screenshot({
    element: element as Element,
    path: `test-results/visual/${name}.png`
  })
}

// Take a full page screenshot
export async function screenshotPage(name: string) {
  await new Promise(resolve => setTimeout(resolve, 500)) // Wait for page to stabilize
  return await page.screenshot({ path: `test-results/visual/${name}.png` })
}

// Wait for the node graph to be ready
export async function waitForNodeGraph() {
  await waitForSelector('.react-flow')
  await new Promise(resolve => setTimeout(resolve, 500)) // Wait for graph to render
}

// Wait for Theatre.js timeline to be ready
export async function waitForTimeline() {
  // Theatre.js studio elements
  try {
    await waitForSelector('[data-theatre-id]', 5000)
  } catch {
    // Timeline might not always be visible, that's okay
  }
  await new Promise(resolve => setTimeout(resolve, 300))
}

// Click on a node by its ID
export async function clickNode(nodeId: string) {
  const nodeSelector = `[data-id="${nodeId}"]`
  const element = await waitForSelector(nodeSelector, 5000)
  ;(element as HTMLElement).click()
  await new Promise(resolve => setTimeout(resolve, 200))
}

// Wait for the property panel to open
export async function waitForPropertyPanel() {
  try {
    await waitForSelector('[data-testid="property-panel"], .property-panel', 3000)
  } catch {
    // Panel might not always open, that's okay
  }
  await new Promise(resolve => setTimeout(resolve, 200))
}

