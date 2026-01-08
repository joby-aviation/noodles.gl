// Smoke tests to verify routing works as expected

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from './app'

// Mock the heavy components - routing tests only need to verify routing logic
vi.mock('./timeline-editor', () => ({
  default: () => <div data-testid="timeline-editor">Timeline Editor</div>,
}))

vi.mock('./examples-page', () => ({
  default: () => <div data-testid="examples-page">Examples Page</div>,
}))

describe.skip('Routing Tests', () => {
  afterEach(() => {
    cleanup()
  })

  describe('Basic routing', () => {
    test('root path redirects to examples page', async () => {
      window.history.replaceState({}, '', '/')
      render(<App />)

      // Wait for the redirect to complete and the examples page to render
      const examplesPage = await screen.findByTestId('examples-page', {}, { timeout: 5000 })
      expect(examplesPage).toBeTruthy()

      // Verify the URL was updated
      expect(window.location.pathname).toBe('/examples')
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
    test('redirects from ?project=name to /examples/name', async () => {
      window.history.replaceState({}, '', '/?project=nyc-taxis')
      render(<App />)

      // Should render timeline editor after redirect
      const timelineEditor = await screen.findByTestId('timeline-editor', {}, { timeout: 5000 })
      expect(timelineEditor).toBeTruthy()

      // Should redirect to /examples/nyc-taxis
      expect(window.location.pathname).toBe('/examples/nyc-taxis')
    })

    test('redirects from /some-path?project=name to /examples/name', async () => {
      window.history.replaceState({}, '', '/some-path?project=my-viz')
      render(<App />)

      const timelineEditor = await screen.findByTestId('timeline-editor', {}, { timeout: 5000 })
      expect(timelineEditor).toBeTruthy()

      expect(window.location.pathname).toBe('/examples/my-viz')
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

  describe('404 handling', () => {
    test('unknown paths redirect to /examples', async () => {
      window.history.replaceState({}, '', '/unknown/path')
      render(<App />)

      const examplesPage = await screen.findByTestId('examples-page', {}, { timeout: 5000 })
      expect(examplesPage).toBeTruthy()
      expect(window.location.pathname).toBe('/examples')
    })

    test('deep unknown paths redirect to /examples', async () => {
      window.history.replaceState({}, '', '/foo/bar/baz')
      render(<App />)

      const examplesPage = await screen.findByTestId('examples-page', {}, { timeout: 5000 })
      expect(examplesPage).toBeTruthy()
      expect(window.location.pathname).toBe('/examples')
    })
  })
})
