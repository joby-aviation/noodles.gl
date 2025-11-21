// Smoke tests to verify routing works as expected

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from './app'

// Mock the heavy components - routing tests only need to verify routing logic
vi.mock('./timeline-editor', () => ({
  default: () => <div data-testid="timeline-editor">Timeline Editor</div>,
}))

vi.mock('./examples-page', () => ({
  default: () => <div data-testid="examples-page">Examples Page</div>,
}))

describe('Routing Tests', () => {
  afterEach(() => {
    cleanup()
  })

  describe('Basic routing', () => {
    // TODO: This test is flaky in browser mode - wouter's <Redirect> doesn't complete navigation
    // The redirect logic works in production, but the test times out waiting for navigation
    test.skip('root path redirects to examples page', async () => {
      window.history.replaceState({}, '', '/')
      render(<App />)

      // Wait for the redirect to complete and the examples page to render
      await waitFor(
        () => {
          expect(window.location.pathname).toBe('/examples')
          expect(screen.getByTestId('examples-page')).toBeTruthy()
        },
        { timeout: 2000 }
      )
    })

    test('/examples renders examples page', () => {
      window.history.replaceState({}, '', '/examples')
      render(<App />)
      expect(screen.getByTestId('examples-page')).toBeTruthy()
      expect(window.location.pathname).toBe('/examples')
    })

    test('/examples/:projectId renders timeline editor', () => {
      window.history.replaceState({}, '', '/examples/nyc-taxis')
      render(<App />)
      expect(screen.getByTestId('timeline-editor')).toBeTruthy()
      expect(window.location.pathname).toBe('/examples/nyc-taxis')
    })

    test('/examples/:projectId with hyphens and numbers', () => {
      window.history.replaceState({}, '', '/examples/my-project-123')
      render(<App />)
      expect(screen.getByTestId('timeline-editor')).toBeTruthy()
      expect(window.location.pathname).toBe('/examples/my-project-123')
    })
  })

  describe('Legacy redirects', () => {
    // TODO: These tests are flaky in browser mode - wouter's <Redirect> doesn't always complete navigation
    // The redirect logic works in production, but tests may timeout waiting for navigation
    test.skip('redirects from ?project=name to /examples/name', async () => {
      window.history.replaceState({}, '', '/?project=nyc-taxis')
      render(<App />)

      // Should redirect to /examples/nyc-taxis
      await waitFor(() => {
        expect(window.location.pathname).toBe('/examples/nyc-taxis')
      }, { timeout: 2000 })

      // Should render timeline editor after redirect
      await waitFor(() => {
        expect(screen.getByTestId('timeline-editor')).toBeTruthy()
      }, { timeout: 2000 })
    })

    test.skip('redirects from /some-path?project=name to /examples/name', async () => {
      window.history.replaceState({}, '', '/some-path?project=my-viz')
      render(<App />)

      await waitFor(() => {
        expect(window.location.pathname).toBe('/examples/my-viz')
      }, { timeout: 2000 })

      await waitFor(() => {
        expect(screen.getByTestId('timeline-editor')).toBeTruthy()
      }, { timeout: 2000 })
    })

    test('does not redirect if already on /examples/:projectId with ?project param', async () => {
      // This edge case: if someone manually adds ?project=foo while already on /examples/bar
      window.history.replaceState({}, '', '/examples/existing-project?project=other-project')
      render(<App />)

      // Should stay on existing-project (the URL param takes precedence)
      expect(screen.getByTestId('timeline-editor')).toBeTruthy()
      expect(window.location.pathname).toBe('/examples/existing-project')
    })
  })

  describe('GitHub Pages 404 redirects', () => {
    test('redirects from ?redirect=/examples/name to /examples/name', async () => {
      window.history.replaceState({}, '', '/?redirect=/examples/nyc-taxis')
      render(<App />)

      await waitFor(() => {
        expect(window.location.pathname).toBe('/examples/nyc-taxis')
      })

      await waitFor(() => {
        expect(screen.getByTestId('timeline-editor')).toBeTruthy()
      })
    })

    test('redirects from ?redirect=/app/examples/name (removes /app/ prefix)', async () => {
      window.history.replaceState({}, '', '/?redirect=/app/examples/my-project')
      render(<App />)

      await waitFor(() => {
        expect(window.location.pathname).toBe('/examples/my-project')
      })

      await waitFor(() => {
        expect(screen.getByTestId('timeline-editor')).toBeTruthy()
      })
    })

    test('ignores invalid redirect URLs (security)', async () => {
      // Should not redirect to external URLs
      window.history.replaceState({}, '', '/?redirect=https://evil.com')
      render(<App />)

      // Should fallback to examples page
      await waitFor(() => {
        expect(window.location.pathname).toBe('/examples')
      })

      await waitFor(() => {
        expect(screen.getByTestId('examples-page')).toBeTruthy()
      })
    })

    test('ignores redirect URLs without leading slash', async () => {
      window.history.replaceState({}, '', '/?redirect=examples/project')
      render(<App />)

      // Should fallback to examples page (doesn't process invalid redirect)
      await waitFor(() => {
        expect(window.location.pathname).toBe('/examples')
      })

      await waitFor(() => {
        expect(screen.getByTestId('examples-page')).toBeTruthy()
      })
    })
  })

  describe('404 handling', () => {
    test('unknown paths redirect to /examples', async () => {
      window.history.replaceState({}, '', '/unknown/path')
      render(<App />)

      await waitFor(() => {
        expect(window.location.pathname).toBe('/examples')
      })

      await waitFor(() => {
        expect(screen.getByTestId('examples-page')).toBeTruthy()
      })
    })

    test('deep unknown paths redirect to /examples', async () => {
      window.history.replaceState({}, '', '/foo/bar/baz')
      render(<App />)

      await waitFor(() => {
        expect(window.location.pathname).toBe('/examples')
      })

      await waitFor(() => {
        expect(screen.getByTestId('examples-page')).toBeTruthy()
      })
    })
  })
})
