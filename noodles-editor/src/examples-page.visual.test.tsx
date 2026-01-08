/**
 * Visual regression tests for the ExamplesPage component
 * 
 * These tests capture screenshots and compare them against baselines to detect
 * visual regressions. Screenshots are stored in __screenshots__ directories.
 * 
 * To update baselines after intentional changes:
 *   yarn test examples-page.visual.test.tsx -u
 * 
 * To view traces for failed tests:
 *   npx playwright show-trace .vitest-traces/<trace-file>.zip
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { page } from '@vitest/browser/context'

// Mock wouter
vi.mock('wouter', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('ExamplesPage Visual Regression', () => {
  afterEach(() => {
    cleanup()
  })

  test('matches visual snapshot of examples page layout', async () => {
    const ExamplesPage = (await import('./examples-page')).default
    render(<ExamplesPage />)

    // Wait for component to stabilize
    await page.waitForTimeout(200)

    // Take a screenshot of the examples page
    const header = screen.getByText('Examples')
    await expect(header).toMatchScreenshot('examples-page-layout.png')
  })

  test('matches visual snapshot of examples grid', async () => {
    const ExamplesPage = (await import('./examples-page')).default
    const { container } = render(<ExamplesPage />)

    // Wait for component to stabilize
    await page.waitForTimeout(200)

    // Find the examples grid
    const grid = container.querySelector('[class*="examplesGrid"]')
    expect(grid).toBeTruthy()

    // Take a screenshot of the grid element
    await expect(page.elementLocator(grid as HTMLElement)).toMatchScreenshot(
      'examples-grid.png'
    )
  })

  test('page title and description are visible', async () => {
    const ExamplesPage = (await import('./examples-page')).default
    render(<ExamplesPage />)

    // Verify text content renders
    expect(screen.getByText('Examples')).toBeTruthy()
    expect(screen.getByText(/Explore example projects/)).toBeTruthy()

    // Wait for any async rendering
    await page.waitForTimeout(100)

    // Take screenshot for visual baseline
    const title = screen.getByText('Examples')
    await expect(title).toMatchScreenshot('examples-page-title.png')
  })
})
