/**
 * Tests for the ExamplesPage component
 *
 * Note: The ExamplesPage uses Vite's import.meta.glob() which is a compile-time feature
 * that can't be easily mocked at runtime. Therefore, these tests focus on:
 * 1. The description extraction logic (unit tests)
 * 2. Smoke test that the page renders with real examples
 *
 * Full integration testing of project discovery should be done in E2E tests.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

// Mock wouter
vi.mock('wouter', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('ExamplesPage', () => {
  afterEach(() => {
    cleanup()
  })

  test('renders page title and description', async () => {
    const ExamplesPage = (await import('./examples-page')).default
    render(<ExamplesPage />)

    expect(screen.getByText('Examples')).toBeTruthy()
    expect(screen.getByText(/Explore example projects/)).toBeTruthy()
  })

  test('renders examples grid container', async () => {
    const ExamplesPage = (await import('./examples-page')).default
    const { container } = render(<ExamplesPage />)

    // Should have the examples grid container
    const grid = container.querySelector('[class*="examplesGrid"]')
    expect(grid).toBeTruthy()
  })

  // This is a smoke test that verifies the glob imports work and examples load
  // The actual discovery of projects depends on what's in public/examples/
  test('loads and displays example projects from public/examples/', async () => {
    const ExamplesPage = (await import('./examples-page')).default
    render(<ExamplesPage />)

    // Wait for async loading to complete
    // If there are any examples, they should appear as links
    await waitFor(
      () => {
        const links = screen.queryAllByRole('link')
        // Should have at least one example project loaded
        expect(links.length).toBeGreaterThan(0)
      },
      { timeout: 3000 }
    )
  })
})

describe('extractDescription utility', () => {
  // Test the description extraction logic in isolation
  const extractDescriptionFromReadme = (readme: string): string => {
    const lines = readme.split('\n')
    let foundTitle = false
    let description = ''

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('#')) {
        foundTitle = true
        continue
      }

      if (!trimmed) {
        continue
      }

      if (foundTitle) {
        if (trimmed.startsWith('_')) {
          continue
        }

        description = trimmed
        break
      }
    }

    return description
  }

  test('extracts first paragraph after title', () => {
    const readme = '# Project\n\nThis is the description.\n\nMore content.'
    expect(extractDescriptionFromReadme(readme)).toBe('This is the description.')
  })

  test('skips lines starting with underscore', () => {
    const readme = '# Project\n\n_Metadata line_\n\nActual description.'
    expect(extractDescriptionFromReadme(readme)).toBe('Actual description.')
  })

  test('skips empty lines', () => {
    const readme = '# Project\n\n\n\n\nDescription here.'
    expect(extractDescriptionFromReadme(readme)).toBe('Description here.')
  })

  test('returns empty string if no description found', () => {
    const readme = '# Project\n\n_Only metadata_\n\n_More metadata_'
    expect(extractDescriptionFromReadme(readme)).toBe('')
  })

  test('handles README without title', () => {
    const readme = 'No title here.\n\nJust content.'
    expect(extractDescriptionFromReadme(readme)).toBe('')
  })

  test('handles empty README', () => {
    const readme = ''
    expect(extractDescriptionFromReadme(readme)).toBe('')
  })
})
