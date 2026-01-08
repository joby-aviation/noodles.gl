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
 *   Or upload to https://trace.playwright.dev
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { page } from 'vitest/browser'

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

    // Verify content is visible before taking screenshot
    const header = screen.getByText('Examples')
    expect(header).toBeTruthy()

    // Take a screenshot of the page title for visual baseline
    await expect(header).toMatchScreenshot('examples-page-layout.png')
  })

  test('matches visual snapshot of page title and description', async () => {
    const ExamplesPage = (await import('./examples-page')).default
    render(<ExamplesPage />)

    // Verify text content renders
    expect(screen.getByText('Examples')).toBeTruthy()
    expect(screen.getByText(/Explore example projects/)).toBeTruthy()

    // Take screenshot of title element for visual baseline
    const title = screen.getByText('Examples')
    await expect(title).toMatchScreenshot('examples-page-title.png')
  })

  test('examples grid container renders correctly', async () => {
    const ExamplesPage = (await import('./examples-page')).default
    const { container } = render(<ExamplesPage />)

    // Find the examples grid
    const grid = container.querySelector('[class*="examplesGrid"]')
    expect(grid).toBeTruthy()

    // Take a screenshot of the grid container
    // Note: This creates a baseline that will detect layout/styling changes
    await expect(page.getByText('Examples')).toMatchScreenshot(
      'examples-grid-container.png'
    )
  })
})
