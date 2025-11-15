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

describe('Routing Tests', () => {
  afterEach(() => {
    cleanup()
  })

  test('root path renders examples page', () => {
    window.history.replaceState({}, '', '/')
    render(<App />)
    expect(screen.getByTestId('examples-page')).toBeTruthy()
  })

  test('/examples renders examples page', () => {
    window.history.replaceState({}, '', '/examples')
    render(<App />)
    expect(screen.getByTestId('examples-page')).toBeTruthy()
  })

  test('/examples/:projectId renders timeline editor', () => {
    window.history.replaceState({}, '', '/examples/nyc-taxis')
    render(<App />)
    expect(screen.getByTestId('timeline-editor')).toBeTruthy()
    expect(window.location.pathname).toBe('/examples/nyc-taxis')
  })
})
